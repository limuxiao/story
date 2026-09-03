import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../db/database.service';
import { AnalysisResult, analyzeLocally } from './local-analyzer';

interface AnalyzeInput {
  submissionId: number;
  moduleId: string;
  moduleTitle: string;
  dimensions: string[];
  exerciseTitle?: string;
  exercisePrompt?: string;
  requirements?: string[];
  minWords: number;
  title?: string;
  content: string;
  selfNote?: string;
}

const SYSTEM_PROMPT = `你是一位严厉但讲道理的网文主编，专门为写作者做练习批改。
你的任务：针对用户提交的练习内容，按给定的评分维度打分，并给出可直接执行的修改建议。
要求：
1. 只评价文本本身，不吹捧，不空泛。每条意见都要能落到具体句子或具体做法上。
2. 优点要具体（指出是哪一句、为什么好），缺点要指出问题出在哪一段。
3. 建议必须是可执行的动作，不要说"多加练习"这种废话。
4. 必须严格按指定 JSON 结构输出，不要输出多余文字。`;

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(private db: DatabaseService) {}

  get config() {
    const row = this.db.all<{ key: string; value: string }>(
      "SELECT key, value FROM settings WHERE key IN ('ai_api_key','ai_base_url','ai_model')",
    );
    const map: Record<string, string> = {};
    row.forEach((r) => (map[r.key] = r.value || ''));
    const apiKey = process.env.AI_API_KEY || map['ai_api_key'] || '';
    const baseUrl =
      process.env.AI_BASE_URL ||
      map['ai_base_url'] ||
      'https://api.openai.com/v1';
    const model = process.env.AI_MODEL || map['ai_model'] || 'gpt-4o-mini';
    return { apiKey, baseUrl, model, enabled: !!apiKey };
  }

  saveConfig(cfg: { apiKey?: string; baseUrl?: string; model?: string }) {
    const put = (k: string, v: string) =>
      this.db.run(
        'INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        [k, v],
      );
    if (cfg.apiKey !== undefined) put('ai_api_key', cfg.apiKey);
    if (cfg.baseUrl !== undefined) put('ai_base_url', cfg.baseUrl);
    if (cfg.model !== undefined) put('ai_model', cfg.model);
    return this.config;
  }

  async analyze(input: AnalyzeInput): Promise<AnalysisResult> {
    const { enabled } = this.config;
    if (!enabled) {
      return analyzeLocally(
        input.content,
        input.moduleId,
        input.dimensions,
        input.minWords,
        input.title,
      );
    }
    try {
      const result = await this.callModel(input);
      return result;
    } catch (err: any) {
      this.logger.warn(`AI 分析失败，降级为本地诊断：${err?.message || err}`);
      const local = analyzeLocally(
        input.content,
        input.moduleId,
        input.dimensions,
        input.minWords,
        input.title,
      );
      local.verdict = `（AI 调用失败，已降级为本地诊断：${err?.message || '未知错误'}）${local.verdict}`;
      return local;
    }
  }

  private buildAnalyzePrompt(input: AnalyzeInput) {
    const req = (input.requirements || []).map((r, i) => `${i + 1}. ${r}`).join('\n');
    return `【练习环节】${input.moduleTitle}
【练习题】${input.exerciseTitle || '（自由练笔）'}
【题目要求】
${input.exercisePrompt || '（自由练笔，无指定题目）'}
${req ? `\n【本题要求】\n${req}` : ''}
【要求字数】${input.minWords} 字
【评分维度】${input.dimensions.join(' / ')}

【用户提交】${input.title ? `标题：${input.title}\n` : ''}
${input.content}
${input.selfNote ? `\n【作者自述】${input.selfNote}` : ''}

请输出如下 JSON：
{
  "score": 总评分数(0-100 的整数),
  "verdict": "一句话总评，不超过 40 字",
  "dimensions": [{"name": "维度名", "score": 分数, "comment": "该维度的具体评语，不超过 60 字"}],
  "strengths": ["优点，需指出具体是哪一处"],
  "weaknesses": ["缺点，需指出问题出在哪一段或哪一句"],
  "suggestions": ["可执行的修改动作"],
  "rewrite": "挑出最需要改进的一段原文，给出改写后的版本，并说明改了什么、为什么。格式：原文：……\\n改写：……\\n说明：……"
}`;
  }

  private async callModel(input: AnalyzeInput): Promise<AnalysisResult> {
    const { apiKey, baseUrl, model } = this.config;
    const body = {
      model,
      temperature: 0.6,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: this.buildAnalyzePrompt(input as any),
        },
      ],
      response_format: { type: 'json_object' },
    };

    const resp = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      throw new Error(`接口返回 ${resp.status}`);
    }
    const json: any = await resp.json();
    const raw = json?.choices?.[0]?.message?.content || '{}';
    const parsed = JSON.parse(this.stripCodeFence(raw));
    const dims = Array.isArray(parsed.dimensions)
      ? parsed.dimensions
      : input.dimensions.map((d) => ({ name: d, score: parsed.score || 60, comment: '' }));
    return {
      score: Number(parsed.score) || 60,
      verdict: parsed.verdict || '',
      dimensions: dims,
      strengths: this.asArray(parsed.strengths),
      weaknesses: this.asArray(parsed.weaknesses),
      suggestions: this.asArray(parsed.suggestions),
      rewrite: parsed.rewrite || '',
      source: 'ai',
      stats: {},
    };
  }

  /** AI 陪聊：围绕当前练习环节答疑、点评、共创 */
  async chat(params: {
    moduleId?: string;
    moduleTitle?: string;
    lessonTitle?: string;
    context?: string;
    messages: { role: 'user' | 'assistant'; content: string }[];
  }): Promise<{ role: string; content: string; source: 'ai' | 'local' }> {
    const { enabled, apiKey, baseUrl, model } = this.config;
    if (!enabled) {
      return {
        role: 'assistant',
        content: this.localChatReply(params),
        source: 'local',
      };
    }
    const system = `你是网文写作陪练助手，熟悉网文的爽点、节奏、人物、结构与商业化写作。
当前用户所在的练习环节：${params.moduleTitle || '综合'}。
回答要具体、直接、给例子，不要泛泛而谈。中文回答，控制在 500 字以内，必要时用分点。`;
    const ctx = params.context
      ? `\n【用户正在写的内容（节选）】\n${params.context.slice(0, 3000)}`
      : '';
    const resp = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.7,
        messages: [
          { role: 'system', content: system },
          ...params.messages.slice(-12).map((m) => ({
            role: m.role,
            content: (m.role === 'user' && ctx && m === params.messages[params.messages.length - 1]
              ? m.content + ctx
              : m.content),
          })),
        ],
      }),
    });
    if (!resp.ok) throw new Error(`接口返回 ${resp.status}`);
    const json: any = await resp.json();
    return {
      role: 'assistant',
      content: json?.choices?.[0]?.message?.content || '（模型没有返回内容）',
      source: 'ai',
    };
  }

  private localChatReply(params: {
    moduleTitle?: string;
    messages: { role: string; content: string }[];
  }): string {
    const last = params.messages[params.messages.length - 1]?.content || '';
    return (
      `【本地模式】还没有配置大模型接口，我只能给你规则和方法，不能读你的内容。\n\n` +
      `你刚才问的是：「${last.slice(0, 40)}${last.length > 40 ? '……' : ''}」\n\n` +
      `在「${params.moduleTitle || '当前环节'}」这一块，建议先做三件事：\n` +
      `1. 把本模块的教程再读一遍，对照四条达标标准给自己打勾；\n` +
      `2. 按练习题要求先写成稿，再点"AI 分析"，让诊断器给你量化反馈；\n` +
      `3. 改稿时一次只改一层：先结构，再人物，最后才是句子。\n\n` +
      `如果你想要真正能读你稿子的 AI 点评，在右上角的「AI 设置」里填入接口地址、模型名和密钥即可（支持 OpenAI 兼容接口）。`
    );
  }

  private stripCodeFence(s: string) {
    return s
      .replace(/^\s*```(?:json)?/i, '')
      .replace(/```\s*$/, '')
      .trim();
  }

  private asArray(v: any): string[] {
    if (Array.isArray(v)) return v.map((x) => String(x));
    if (typeof v === 'string' && v.trim()) return [v];
    return [];
  }
}
