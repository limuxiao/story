import { Body, Controller, Get, Post, Put } from '@nestjs/common';
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
export class SystemController {
  constructor(
    private db: DatabaseService,
    private ai: AiService,
  ) {}

  @Get('health')
  health() {
    const cfg = this.ai.config;
    return {
      ok: true,
      time: new Date().toISOString(),
      aiEnabled: cfg.enabled,
      model: cfg.enabled ? cfg.model : null,
    };
  }

  /** 总览：阶段进度 + 今日要处理 + 统计 + 热力图 */
  @Get('overview')
  overview() {
    const stages = this.db.all<any>('SELECT * FROM stages ORDER BY sort_order');
    const modulesRaw = this.db.all<any>('SELECT * FROM modules ORDER BY sort_order');

    const moduleStats = modulesRaw.map((m) => {
      const subs = this.db.get<{ c: number; w: number }>(
        'SELECT COUNT(*) AS c, COALESCE(SUM(word_count),0) AS w FROM submissions WHERE module_id = ?',
        [m.id],
      );
      const exerciseCount = this.db.get<{ c: number }>(
        'SELECT COUNT(*) AS c FROM exercises WHERE module_id = ?',
        [m.id],
      ).c;
      const doneExercises = this.db.get<{ c: number }>(
        "SELECT COUNT(DISTINCT exercise_id) AS c FROM submissions WHERE module_id = ? AND status = 'done'",
        [m.id],
      ).c;
      const lessonsDone = this.db.get<{ c: number }>(
        'SELECT COUNT(*) AS c FROM lesson_progress WHERE module_id = ? AND done = 1',
        [m.id],
      ).c;
      const lessonCount = this.db.get<{ c: number }>(
        'SELECT COUNT(*) AS c FROM lessons WHERE module_id = ?',
        [m.id],
      ).c;
      const avg = this.db.get<{ s: number }>(
        'SELECT COALESCE(AVG(score),0) AS s FROM analyses WHERE module_id = ?',
        [m.id],
      ).s;
      let status = 'not_started';
      if (subs.c > 0) status = 'in_progress';
      if (exerciseCount > 0 && doneExercises >= exerciseCount) status = 'done';
      return {
        id: m.id,
        title: m.title,
        subtitle: m.subtitle,
        stage: m.stage,
        icon: m.icon,
        goal: m.goal,
        lessonCount,
        lessonsDone,
        exerciseCount,
        doneExercises,
        words: subs.w || 0,
        avgScore: Math.round(avg || 0),
        status,
        progress: exerciseCount ? Math.round((doneExercises / exerciseCount) * 100) : 0,
      };
    });

    const stageList = stages.map((s) => {
      const ids: string[] = parseJson(s.module_ids, []);
      const mods = moduleStats.filter((m) => ids.includes(m.id));
      const done = mods.filter((m) => m.status === 'done').length;
      const started = mods.filter((m) => m.status !== 'not_started').length;
      return {
        id: s.id,
        name: s.name,
        subtitle: s.subtitle,
        weeks: s.weeks,
        goal: s.goal,
        focus: s.focus,
        sortOrder: s.sort_order,
        moduleIds: ids,
        modules: mods,
        status:
          done === mods.length && mods.length > 0
            ? 'done'
            : started > 0
              ? 'in_progress'
              : 'not_started',
        progress: mods.length
          ? Math.round(
              mods.reduce((a, b) => a + b.progress, 0) / mods.length,
            )
          : 0,
      };
    });

    const totals = this.db.get<any>(
      `SELECT
        (SELECT COALESCE(SUM(word_count),0) FROM submissions) AS words,
        (SELECT COUNT(*) FROM submissions) AS submissions,
        (SELECT COUNT(*) FROM analyses) AS analyses,
        (SELECT COALESCE(AVG(score),0) FROM analyses) AS avgScore,
        (SELECT COUNT(*) FROM lesson_progress WHERE done = 1) AS lessonsDone,
        (SELECT COUNT(*) FROM lessons) AS lessonCount,
        (SELECT COUNT(*) FROM exercises) AS exerciseCount,
        (SELECT COUNT(*) FROM works) AS works`,
    );

    // ---- 今日要处理 ----
    const now = Date.now();
    const drafts = this.db
      .all<any>(
        `SELECT s.id, s.module_id, s.exercise_id, s.title, s.word_count, s.updated_at, s.status,
                m.title AS module_title, e.title AS exercise_title, e.min_words
         FROM submissions s
         LEFT JOIN modules m ON m.id = s.module_id
         LEFT JOIN exercises e ON e.id = s.exercise_id
         WHERE s.status = 'draft'
         ORDER BY s.updated_at DESC`,
      )
      .map((d) => ({
        ...d,
        overdue: now - new Date(d.updated_at).getTime() > 3 * 24 * 3600 * 1000,
        daysIdle: Math.floor(
          (now - new Date(d.updated_at).getTime()) / (24 * 3600 * 1000),
        ),
        reason:
          d.word_count < (d.min_words || 200)
            ? `字数 ${d.word_count} / 要求 ${d.min_words || 200}，还没写完`
            : '草稿尚未标记完成',
      }));

    const needRework = this.db.all<any>(
      `SELECT s.id, s.title, s.module_id, s.word_count, m.title AS module_title, MAX(a.score) AS score
       FROM submissions s
       JOIN analyses a ON a.submission_id = s.id
       LEFT JOIN modules m ON m.id = s.module_id
       GROUP BY s.id
       HAVING score < 70
       ORDER BY score ASC
       LIMIT 6`,
    );

    const currentStage =
      stageList.find((s) => s.status === 'in_progress') ||
      stageList.find((s) => s.status === 'not_started');
    const pendingModules = currentStage
      ? currentStage.modules.filter((m) => m.status === 'not_started')
      : [];

    const todo = [
      ...drafts
        .filter((d) => d.overdue)
        .map((d) => ({
          type: 'overdue',
          level: 'danger',
          title: d.title || d.exercise_title || '未命名练习',
          desc: `${d.module_title} · 已搁置 ${d.daysIdle} 天 · ${d.reason}`,
          link: `/module/${d.module_id}?submission=${d.id}`,
        })),
      ...drafts
        .filter((d) => !d.overdue)
        .slice(0, 4)
        .map((d) => ({
          type: 'draft',
          level: 'warn',
          title: d.title || d.exercise_title || '未命名练习',
          desc: `${d.module_title} · ${d.reason}`,
          link: `/module/${d.module_id}?submission=${d.id}`,
        })),
      ...needRework.map((r) => ({
        type: 'rework',
        level: 'warn',
        title: r.title || '未命名练习',
        desc: `${r.module_title} · 最近一次诊断 ${Math.round(r.score)} 分，建议返工`,
        link: `/module/${r.module_id}?submission=${r.id}`,
      })),
      ...pendingModules.slice(0, 2).map((m) => ({
        type: 'todo',
        level: 'info',
        title: `开始「${m.title}」`,
        desc: `${currentStage?.name}阶段 · ${m.subtitle}`,
        link: `/module/${m.id}`,
      })),
    ].slice(0, 8);

    const heatmap = this.db.all<any>(
      `SELECT day, words, submissions, analyses FROM daily_logs
       ORDER BY day DESC LIMIT 60`,
    );

    const todayRow = this.db.get<any>(
      'SELECT * FROM daily_logs WHERE day = ?',
      [today()],
    ) || { words: 0, submissions: 0, analyses: 0 };

    const recent = this.db.all<any>(
      `SELECT s.id, s.title, s.module_id, s.word_count, s.updated_at, m.title AS module_title
       FROM submissions s LEFT JOIN modules m ON m.id = s.module_id
       ORDER BY s.updated_at DESC LIMIT 8`,
    );

    const recentAnalyses = this.db.all<any>(
      `SELECT a.id, a.submission_id, a.module_id, a.score, a.verdict, a.created_at, a.source,
              s.title AS submission_title
       FROM analyses a LEFT JOIN submissions s ON s.id = a.submission_id
       ORDER BY a.created_at DESC LIMIT 6`,
    );

    return {
      stages: stageList,
      totals: {
        words: totals.words || 0,
        submissions: totals.submissions || 0,
        analyses: totals.analyses || 0,
        avgScore: Math.round(totals.avgScore || 0),
        lessonsDone: totals.lessonsDone || 0,
        lessonCount: totals.lessonCount || 0,
        exerciseCount: totals.exerciseCount || 0,
        works: totals.works || 0,
      },
      todo,
      today: todayRow,
      heatmap,
      recent,
      recentAnalyses,
      currentStage,
    };
  }

  @Get('settings/ai')
  getAiSettings() {
    const cfg = this.ai.config;
    return {
      enabled: cfg.enabled,
      baseUrl: cfg.baseUrl,
      model: cfg.model,
      hasKey: cfg.enabled,
    };
  }

  @Put('settings/ai')
  setAiSettings(@Body() body: any) {
    const cfg = this.ai.saveConfig({
      apiKey: body.apiKey,
      baseUrl: body.baseUrl,
      model: body.model,
    });
    return { enabled: cfg.enabled, baseUrl: cfg.baseUrl, model: cfg.model };
  }

  @Get('export')
  exportAll() {
    const pick = (t: string) => this.db.all(`SELECT * FROM ${t}`);
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      submissions: pick('submissions'),
      analyses: pick('analyses'),
      works: pick('works'),
      chat_messages: pick('chat_messages'),
      lesson_progress: pick('lesson_progress'),
      daily_logs: pick('daily_logs'),
    };
  }

  @Post('import')
  importAll(@Body() body: any) {
    if (!body) return { ok: false, message: '数据为空' };
    this.db.transaction(() => {
      const replace = (table: string, rows: any[], cols: string[]) => {
        if (!Array.isArray(rows)) return;
        this.db.run(`DELETE FROM ${table}`);
        const stmt = this.db.instance.prepare(
          `INSERT INTO ${table}(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`,
        );
        for (const r of rows) {
          stmt.run(cols.map((c) => r[c] ?? null));
        }
      };
      replace(
        'submissions',
        body.submissions,
        [
          'id',
          'module_id',
          'exercise_id',
          'title',
          'content',
          'word_count',
          'self_note',
          'status',
          'created_at',
          'updated_at',
        ],
      );
      replace(
        'analyses',
        body.analyses,
        [
          'id',
          'submission_id',
          'module_id',
          'score',
          'verdict',
          'dimensions',
          'strengths',
          'weaknesses',
          'suggestions',
          'rewrite',
          'source',
          'raw',
          'created_at',
        ],
      );
      replace(
        'works',
        body.works,
        [
          'id',
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
          'created_at',
          'updated_at',
        ],
      );
      replace('chat_messages', body.chat_messages, [
        'id',
        'module_id',
        'role',
        'content',
        'created_at',
      ]);
      replace('lesson_progress', body.lesson_progress, [
        'module_id',
        'lesson_id',
        'done',
        'updated_at',
      ]);
      replace('daily_logs', body.daily_logs, ['day', 'words', 'submissions', 'analyses']);
    });
    return { ok: true };
  }

  @Post('danger/reset')
  resetUserData() {
    this.db.transaction(() => {
      ['submissions', 'analyses', 'chat_messages', 'lesson_progress', 'daily_logs'].forEach(
        (t) => this.db.run(`DELETE FROM ${t}`),
      );
    });
    return { ok: true };
  }
}
