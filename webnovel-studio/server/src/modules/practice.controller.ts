import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { DatabaseService } from '../db/database.service';
import { AiService } from '../ai/ai.service';

function parseJson<T>(s: any, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

function today() {
  const d = new Date();
  const p = (n: number) => (n < 10 ? '0' : '') + n;
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

@Controller('api')
export class PracticeController {
  constructor(
    private db: DatabaseService,
    private ai: AiService,
  ) {}

  /* ---------------- 练习提交 ---------------- */

  @Get('submissions')
  list(@Query('moduleId') moduleId?: string, @Query('exerciseId') exerciseId?: string) {
    let sql =
      'SELECT id, module_id, exercise_id, title, content, word_count, self_note, status, created_at, updated_at FROM submissions';
    const params: any[] = [];
    const where: string[] = [];
    if (moduleId) {
      where.push('module_id = ?');
      params.push(moduleId);
    }
    if (exerciseId) {
      where.push('exercise_id = ?');
      params.push(exerciseId);
    }
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    sql += ' ORDER BY updated_at DESC';
    return this.db.all(sql, params);
  }

  @Get('submissions/:id')
  detail(@Param('id') id: string) {
    const row = this.db.get<any>(
      'SELECT * FROM submissions WHERE id = ?',
      [id],
    );
    if (!row) return null;
    const analyses = this.db
      .all<any>(
        'SELECT * FROM analyses WHERE submission_id = ? ORDER BY created_at DESC',
        [id],
      )
      .map((a) => ({
        ...a,
        dimensions: parseJson(a.dimensions, []),
        strengths: parseJson(a.strengths, []),
        weaknesses: parseJson(a.weaknesses, []),
        suggestions: parseJson(a.suggestions, []),
        stats: parseJson(a.stats, {}),
      }));
    return { ...row, analyses };
  }

  @Post('submissions')
  create(@Body() body: any) {
    const now = new Date().toISOString();
    const content = body?.content ?? '';
    const wordCount = this.countWords(content);
    const res = this.db.run(
      `INSERT INTO submissions(module_id, exercise_id, title, content, word_count, self_note, status, created_at, updated_at)
       VALUES(?,?,?,?,?,?,?,?,?)`,
      [
        body.moduleId,
        body.exerciseId || null,
        body.title || '',
        content,
        wordCount,
        body.selfNote || '',
        body.status || 'draft',
        now,
        now,
      ],
    );
    this.log(0, wordCount, 1);
    return { id: res.lastInsertRowid };
  }

  @Put('submissions/:id')
  update(@Param('id') id: string, @Body() body: any) {
    const existing = this.db.get<any>(
      'SELECT * FROM submissions WHERE id = ?',
      [id],
    );
    if (!existing) return { ok: false };
    const content = body.content !== undefined ? body.content : existing.content;
    const wordCount = this.countWords(content);
    const now = new Date().toISOString();
    this.db.run(
      `UPDATE submissions SET module_id = ?, exercise_id = ?, title = ?, content = ?,
       word_count = ?, self_note = ?, status = ?, updated_at = ? WHERE id = ?`,
      [
        body.moduleId ?? existing.module_id,
        body.exerciseId !== undefined ? body.exerciseId : existing.exercise_id,
        body.title !== undefined ? body.title : existing.title,
        content,
        wordCount,
        body.selfNote !== undefined ? body.selfNote : existing.self_note,
        body.status ?? existing.status,
        now,
        id,
      ],
    );
    this.log(0, Math.max(0, wordCount - (existing.word_count || 0)), 0);
    return { ok: true, wordCount };
  }

  @Delete('submissions/:id')
  remove(@Param('id') id: string) {
    this.db.run('DELETE FROM analyses WHERE submission_id = ?', [id]);
    this.db.run('DELETE FROM submissions WHERE id = ?', [id]);
    return { ok: true };
  }

  /* ---------------- AI 分析 ---------------- */

  @Post('submissions/:id/analyze')
  async analyze(@Param('id') id: string) {
    const sub = this.db.get<any>('SELECT * FROM submissions WHERE id = ?', [id]);
    if (!sub) return { ok: false, message: '提交不存在' };

    const mod = this.db.get<any>('SELECT * FROM modules WHERE id = ?', [
      sub.module_id,
    ]);
    const ex = sub.exercise_id
      ? this.db.get<any>('SELECT * FROM exercises WHERE id = ?', [sub.exercise_id])
      : null;

    const result = await this.ai.analyze({
      submissionId: Number(id),
      moduleId: sub.module_id,
      moduleTitle: mod?.title || '',
      dimensions: parseJson(mod?.dimensions, ['内容完整度', '表达清晰度', '技巧运用', '可执行性']),
      exerciseTitle: ex?.title || sub.title,
      exercisePrompt: ex?.prompt,
      requirements: parseJson(ex?.rubric, []),
      minWords: ex?.min_words || 200,
      title: sub.title,
      content: sub.content || '',
      selfNote: sub.self_note,
    });

    const now = new Date().toISOString();
    const res = this.db.run(
      `INSERT INTO analyses(submission_id, module_id, score, verdict, dimensions, strengths, weaknesses, suggestions, rewrite, source, raw, created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        sub.id,
        sub.module_id,
        result.score,
        result.verdict,
        JSON.stringify(result.dimensions),
        JSON.stringify(result.strengths),
        JSON.stringify(result.weaknesses),
        JSON.stringify(result.suggestions),
        result.rewrite || '',
        result.source,
        JSON.stringify(result.stats || {}),
        now,
      ],
    );
    this.log(0, 0, 0, 1);
    return { ok: true, id: res.lastInsertRowid, ...result };
  }

  @Get('analyses')
  listAnalyses(
    @Query('submissionId') submissionId?: string,
    @Query('moduleId') moduleId?: string,
    @Query('limit') limit?: string,
  ) {
    let sql = 'SELECT * FROM analyses';
    const params: any[] = [];
    const where: string[] = [];
    if (submissionId) {
      where.push('submission_id = ?');
      params.push(submissionId);
    }
    if (moduleId) {
      where.push('module_id = ?');
      params.push(moduleId);
    }
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    sql += ' ORDER BY created_at DESC LIMIT ' + (Number(limit) || 50);
    return this.db.all<any>(sql, params).map((a) => ({
      ...a,
      dimensions: parseJson(a.dimensions, []),
      strengths: parseJson(a.strengths, []),
      weaknesses: parseJson(a.weaknesses, []),
      suggestions: parseJson(a.suggestions, []),
      stats: parseJson(a.stats, {}),
    }));
  }

  @Delete('analyses/:id')
  removeAnalysis(@Param('id') id: string) {
    this.db.run('DELETE FROM analyses WHERE id = ?', [id]);
    return { ok: true };
  }

  /* ---------------- 课程已读标记 ---------------- */

  @Put('lesson-progress')
  setLessonProgress(@Body() body: any) {
    this.db.run(
      `INSERT INTO lesson_progress(module_id, lesson_id, done, updated_at)
       VALUES(?,?,?,?) ON CONFLICT(module_id, lesson_id) DO UPDATE SET done = excluded.done, updated_at = excluded.updated_at`,
      [body.moduleId, body.lessonId, body.done ? 1 : 0, new Date().toISOString()],
    );
    return { ok: true };
  }

  /* ---------------- AI 聊天 ---------------- */

  @Get('chat')
  getChat(@Query('moduleId') moduleId?: string) {
    const sql = moduleId
      ? 'SELECT id, role, content, created_at FROM chat_messages WHERE module_id = ? ORDER BY id'
      : 'SELECT id, role, content, created_at FROM chat_messages ORDER BY id';
    return this.db.all(sql, moduleId ? [moduleId] : []);
  }

  @Post('chat')
  async chat(@Body() body: any) {
    const history = this.db.all<{ role: string; content: string }>(
      moduleIdFilter(body.moduleId).sql,
      moduleIdFilter(body.moduleId).params,
    );
    this.db.run(
      'INSERT INTO chat_messages(module_id, role, content, created_at) VALUES(?,?,?,?)',
      [body.moduleId || null, 'user', body.message, new Date().toISOString()],
    );

    let reply: { role: string; content: string; source: string };
    try {
      const mod = body.moduleId
        ? this.db.get<any>('SELECT title FROM modules WHERE id = ?', [body.moduleId])
        : null;
      reply = await this.ai.chat({
        moduleId: body.moduleId,
        moduleTitle: mod?.title,
        context: body.context,
        messages: [
          ...history.map((h: any) => ({ role: h.role, content: h.content })),
          { role: 'user', content: body.message },
        ],
      });
    } catch (err: any) {
      reply = {
        role: 'assistant',
        content: `AI 调用失败：${err?.message || err}。请检查右上角的 AI 设置（接口地址、模型名、密钥）是否正确。`,
        source: 'local',
      };
    }

    this.db.run(
      'INSERT INTO chat_messages(module_id, role, content, created_at) VALUES(?,?,?,?)',
      [body.moduleId || null, 'assistant', reply.content, new Date().toISOString()],
    );
    return reply;
  }

  @Delete('chat')
  clearChat(@Query('moduleId') moduleId?: string) {
    if (moduleId) {
      this.db.run('DELETE FROM chat_messages WHERE module_id = ?', [moduleId]);
    } else {
      this.db.run('DELETE FROM chat_messages');
    }
    return { ok: true };
  }

  /* ---------------- 工具 ---------------- */

  private countWords(text: string) {
    if (!text) return 0;
    const cjk = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const en = (text.match(/[A-Za-z]+/g) || []).length;
    return cjk + en;
  }

  private log(wordsDelta = 0, words = 0, submissions = 0, analyses = 0) {
    const day = today();
    this.db.run(
      `INSERT INTO daily_logs(day, words, submissions, analyses) VALUES(?,?,?,?)
       ON CONFLICT(day) DO UPDATE SET
         words = daily_logs.words + excluded.words,
         submissions = daily_logs.submissions + excluded.submissions,
         analyses = daily_logs.analyses + excluded.analyses`,
      [day, words + wordsDelta, submissions, analyses],
    );
  }
}

function moduleIdFilter(moduleId?: string) {
  return moduleId
    ? {
        sql: 'SELECT role, content FROM chat_messages WHERE module_id = ? ORDER BY id',
        params: [moduleId] as any[],
      }
    : {
        sql: 'SELECT role, content FROM chat_messages ORDER BY id',
        params: [] as any[],
      };
}
