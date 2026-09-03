import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { DatabaseService } from '../db/database.service';
import { AiService } from '../ai/ai.service';

const FIELDS = [
  'name',
  'genre',
  'liyi',
  'zhuti',
  'genggai',
  'shijieguan',
  'renwu',
  'juqing',
  'fenjuan',
  'wenti',
];

@Controller('api/works')
export class WorksController {
  constructor(
    private db: DatabaseService,
    private ai: AiService,
  ) {}

  @Get()
  list() {
    return this.db.all(
      'SELECT id, name, genre, updated_at, created_at FROM works ORDER BY updated_at DESC',
    );
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.db.get('SELECT * FROM works WHERE id = ?', [id]);
  }

  @Post()
  create(@Body() body: any) {
    const now = new Date().toISOString();
    const cols = FIELDS.map((f) => body?.[f] ?? '');
    const res = this.db.run(
      `INSERT INTO works(${FIELDS.join(',')}, created_at, updated_at)
       VALUES(${FIELDS.map(() => '?').join(',')},?,?)`,
      [...cols, now, now],
    );
    return { id: res.lastInsertRowid };
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() body: any) {
    const existing: any = this.db.get('SELECT * FROM works WHERE id = ?', [id]);
    if (!existing) return { ok: false };
    const sets = FIELDS.map((f) => `${f} = ?`).join(', ');
    const values = FIELDS.map((f) =>
      body[f] !== undefined ? body[f] : existing[f] ?? '',
    );
    this.db.run(
      `UPDATE works SET ${sets}, updated_at = ? WHERE id = ?`,
      [...values, new Date().toISOString(), id],
    );
    return { ok: true };
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    this.db.run('DELETE FROM works WHERE id = ?', [id]);
    return { ok: true };
  }

  /** 对整份九宫格档案做一次整体诊断 */
  @Post(':id/analyze')
  async analyze(@Param('id') id: string) {
    const work: any = this.db.get('SELECT * FROM works WHERE id = ?', [id]);
    if (!work) return { ok: false, message: '档案不存在' };

    const sections: string[] = [];
    const labelMap: Record<string, string> = {
      liyi: '立意',
      zhuti: '主题',
      genggai: '一句话梗概',
      shijieguan: '世界观设定',
      renwu: '人物简介与背景',
      juqing: '剧情总纲',
      fenjuan: '分卷大纲',
      wenti: '当前问题',
    };
    let content = `【书名】${work.name || '（未命名）'}\n【类型】${work.genre || '（未填）'}\n\n`;
    for (const f of FIELDS) {
      if (f === 'name' || f === 'genre') continue;
      const v = (work[f] || '').trim();
      content += `【${labelMap[f]}】\n${v || '（空白）'}\n\n`;
      if (v) sections.push(labelMap[f]);
    }

    const result = await this.ai.analyze({
      submissionId: 0,
      moduleId: 'practice',
      moduleTitle: '综合实战 · 九宫格档案',
      dimensions: ['立意清晰', '结构完整', '人物立住', '可执行性'],
      exerciseTitle: `《${work.name || '未命名'}》整体诊断`,
      exercisePrompt:
        '对一份完整的网文九宫格作品档案做体检：检查九个格子之间是否互相支撑、是否存在矛盾，' +
        '指出最大的结构风险，并给出下一步该动哪一格。已填写的格子：' +
        (sections.join('、') || '（几乎空白）'),
      requirements: [
        '立意与梗概是否指向同一件事',
        '人物欲望是否在剧情总纲中被追求',
        '世界观规则是否被剧情真正用上',
        '分卷大纲每卷是否有目标、阻力、位移、钩子',
      ],
      minWords: 600,
      title: work.name,
      content,
      selfNote: work.wenti,
    });

    // 归档这次诊断（submission_id = 0 表示针对整份档案，而非某次练习）
    this.db.run(
      `INSERT INTO analyses(submission_id, module_id, score, verdict, dimensions, strengths, weaknesses, suggestions, rewrite, source, raw, created_at)
       VALUES(0,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        'practice',
        result.score,
        result.verdict,
        JSON.stringify(result.dimensions),
        JSON.stringify(result.strengths),
        JSON.stringify(result.weaknesses),
        JSON.stringify(result.suggestions),
        result.rewrite || '',
        result.source,
        JSON.stringify(result.stats || {}),
        new Date().toISOString(),
      ],
    );

    return { ok: true, ...result, filledSections: sections };
  }
}
