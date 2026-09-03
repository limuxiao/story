import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../db/database.service';
import { modules, stages } from './curriculum';

@Injectable()
export class SeedService {
  private readonly logger = new Logger(SeedService.name);

  constructor(private db: DatabaseService) {}

  run() {
    const started = Date.now();
    this.db.transaction(() => {
      this.seedStages();
      this.seedModules();
      this.seedWorksIfEmpty();
    });
    const version = `v1-${modules.length}modules-${Date.now()}`;
    this.db.run(
      "INSERT INTO settings(key, value) VALUES('curriculum_version', ?) " +
        'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [version],
    );
    this.logger.log(
      `课程数据已同步：${modules.length} 个模块 / ${stages.length} 个阶段 (${Date.now() - started}ms)`,
    );
  }

  private seedStages() {
    const upsert = this.db.instance.prepare(
      `INSERT INTO stages(id, name, subtitle, weeks, goal, focus, sort_order, module_ids)
       VALUES(@id, @name, @subtitle, @weeks, @goal, @focus, @sortOrder, @moduleIds)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name, subtitle = excluded.subtitle, weeks = excluded.weeks,
         goal = excluded.goal, focus = excluded.focus,
         sort_order = excluded.sort_order, module_ids = excluded.module_ids`,
    );
    for (const s of stages) {
      upsert.run({ ...s, moduleIds: JSON.stringify(s.moduleIds) });
    }
  }

  private seedModules() {
    const upsertModule = this.db.instance.prepare(
      `INSERT INTO modules(id, title, subtitle, stage, sort_order, goal, overview, checklist, dimensions, target_words, icon)
       VALUES(@id, @title, @subtitle, @stage, @sortOrder, @goal, @overview, @checklist, @dimensions, @targetWords, @icon)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title, subtitle = excluded.subtitle, stage = excluded.stage,
         sort_order = excluded.sort_order, goal = excluded.goal, overview = excluded.overview,
         checklist = excluded.checklist, dimensions = excluded.dimensions,
         target_words = excluded.target_words, icon = excluded.icon`,
    );
    const upsertLesson = this.db.instance.prepare(
      `INSERT INTO lessons(id, module_id, sort_order, title, summary, body, keypoints, pitfalls, drill, read_minutes)
       VALUES(@id, @moduleId, @sortOrder, @title, @summary, @body, @keypoints, @pitfalls, @drill, @readMinutes)
       ON CONFLICT(id) DO UPDATE SET
         module_id = excluded.module_id, sort_order = excluded.sort_order,
         title = excluded.title, summary = excluded.summary, body = excluded.body,
         keypoints = excluded.keypoints, pitfalls = excluded.pitfalls,
         drill = excluded.drill, read_minutes = excluded.read_minutes`,
    );
    const upsertExercise = this.db.instance.prepare(
      `INSERT INTO exercises(id, module_id, sort_order, title, prompt, requirements, min_words, reference, rubric)
       VALUES(@id, @moduleId, @sortOrder, @title, @prompt, @requirements, @minWords, @reference, @rubric)
       ON CONFLICT(id) DO UPDATE SET
         module_id = excluded.module_id, sort_order = excluded.sort_order,
         title = excluded.title, prompt = excluded.prompt,
         requirements = excluded.requirements, min_words = excluded.min_words,
         reference = excluded.reference, rubric = excluded.rubric`,
    );

    for (const m of modules) {
      upsertModule.run({
        id: m.id,
        title: m.title,
        subtitle: m.subtitle,
        stage: m.stage,
        sortOrder: m.sortOrder,
        goal: m.goal,
        overview: m.overview,
        checklist: JSON.stringify(m.checklist),
        dimensions: JSON.stringify(m.dimensions),
        targetWords: m.targetWords,
        icon: m.icon,
      });

      m.lessons.forEach((l, i) => {
        upsertLesson.run({
          id: `${m.id}-L${i + 1}`,
          moduleId: m.id,
          sortOrder: i + 1,
          title: l.title,
          summary: l.summary,
          body: l.body.join('\n\n'),
          keypoints: JSON.stringify(l.keypoints),
          pitfalls: JSON.stringify(l.pitfalls),
          drill: l.drill,
          readMinutes: l.readMinutes,
        });
      });

      m.exercises.forEach((e, i) => {
        upsertExercise.run({
          id: `${m.id}-E${i + 1}`,
          moduleId: m.id,
          sortOrder: i + 1,
          title: e.title,
          prompt: e.prompt,
          requirements: JSON.stringify(e.requirements),
          minWords: e.minWords,
          reference: e.reference || '',
          rubric: JSON.stringify(e.rubric),
        });
      });
    }
  }

  private seedWorksIfEmpty() {
    const count = this.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM works');
    if (count.c === 0) {
      const now = new Date().toISOString();
      this.db.run(
        `INSERT INTO works(name, genre, liyi, zhuti, genggai, shijieguan, renwu, juqing, fenjuan, wenti, created_at, updated_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          '示例作品：霜河夜行（删掉它，建你自己的）',
          '玄幻 / 复仇',
          '一个被全城指认为凶手的人，偏要查出真凶——哪怕真凶就是这座城。',
          '清白不是别人给的，是自己一寸一寸讨回来的。',
          '落魄剑客沈霜河在霜河城 Tyr 一夜之间背上屠城之罪，他要在三日内找出真凶、洗清自己，却发现城的守护阵本就是为囚禁他而建。',
          '霜河城以「灵脉」为力量来源，灵脉枯竭者会被阵法剥夺记忆；沈霜河偏偏是最后一个灵脉满盈的人，因此被忌惮。',
          '沈霜河：外冷内热，要洗冤也要守住妹妹；城主：表面慈父，实为阵法操纵者；妹妹：记忆被阵法抹去，认贼作父。',
          '开端：屠城夜沈霜河被栽赃 → 发展：逃亡中逐一拼出真相 → 转折：发现城主即当年灭门仇人 → 高潮：破阵对决 → 结局：洗冤，却选择留下守城。',
          '卷一 栽赃：沈霜河逃出死牢，卷末钩子——妹妹出现在城主身侧。\n卷二 拼图：他找到当年灭门案的幸存者，卷末钩子——幸存者竟是城主旧部。',
          '卡在第二卷中段，反派动机立不住；主角升级缺乏代价，每次变强都太轻松。',
          now,
          now,
        ],
      );
    }
  }
}
