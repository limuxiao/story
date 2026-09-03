import { Controller, Get, Param, Query, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../db/database.service';

function parseJson<T>(s: any, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

@Controller('api')
export class CurriculumController {
  constructor(private db: DatabaseService) {}

  @Get('stages')
  stages() {
    const rows = this.db.all<any>(
      'SELECT * FROM stages ORDER BY sort_order',
    );
    return rows.map((s) => ({
      ...s,
      module_ids: parseJson(s.module_ids, []),
    }));
  }

  @Get('modules')
  modules() {
    const rows = this.db.all<any>('SELECT * FROM modules ORDER BY sort_order');
    return rows.map((m) => this.decorate(m));
  }

  @Get('modules/:id')
  moduleDetail(@Param('id') id: string) {
    const m = this.db.get<any>('SELECT * FROM modules WHERE id = ?', [id]);
    if (!m) throw new NotFoundException('模块不存在');
    const lessons = this.db
      .all<any>('SELECT * FROM lessons WHERE module_id = ? ORDER BY sort_order', [id])
      .map((l) => ({
        ...l,
        keypoints: parseJson(l.keypoints, []),
        pitfalls: parseJson(l.pitfalls, []),
        paragraphs: (l.body || '').split('\n\n').filter(Boolean),
      }));
    const exercises = this.db
      .all<any>('SELECT * FROM exercises WHERE module_id = ? ORDER BY sort_order', [id])
      .map((e) => ({
        ...e,
        requirements: parseJson(e.requirements, []),
        rubric: parseJson(e.rubric, []),
      }));
    const lessonProgress = this.db.all<any>(
      'SELECT lesson_id, done FROM lesson_progress WHERE module_id = ?',
      [id],
    );
    const doneMap: Record<string, number> = {};
    lessonProgress.forEach((p) => (doneMap[p.lesson_id] = p.done));

    const submissions = this.db.all<any>(
      'SELECT id, exercise_id, title, word_count, status, updated_at, created_at FROM submissions WHERE module_id = ? ORDER BY updated_at DESC',
      [id],
    );

    return {
      ...this.decorate(m),
      lessons: lessons.map((l) => ({ ...l, done: !!doneMap[l.id] })),
      exercises: exercises.map((e) => {
        const subs = submissions.filter((s) => s.exercise_id === e.id);
        return {
          ...e,
          submissionCount: subs.length,
          latestSubmissionId: subs[0]?.id || null,
          completed: subs.some((s) => s.status === 'done'),
        };
      }),
      submissions,
    };
  }

  @Get('lessons/:id')
  lesson(@Param('id') id: string) {
    const l = this.db.get<any>('SELECT * FROM lessons WHERE id = ?', [id]);
    if (!l) throw new NotFoundException('课程不存在');
    return {
      ...l,
      keypoints: parseJson(l.keypoints, []),
      pitfalls: parseJson(l.pitfalls, []),
      paragraphs: (l.body || '').split('\n\n').filter(Boolean),
    };
  }

  @Get('exercises')
  exercises(@Query('moduleId') moduleId?: string) {
    const sql = moduleId
      ? 'SELECT * FROM exercises WHERE module_id = ? ORDER BY sort_order'
      : 'SELECT * FROM exercises ORDER BY module_id, sort_order';
    return this.db.all<any>(sql, moduleId ? [moduleId] : []).map((e) => ({
      ...e,
      requirements: parseJson(e.requirements, []),
      rubric: parseJson(e.rubric, []),
    }));
  }

  private decorate(m: any) {
    const lessonCount = this.db.get<{ c: number }>(
      'SELECT COUNT(*) AS c FROM lessons WHERE module_id = ?',
      [m.id],
    ).c;
    const exerciseCount = this.db.get<{ c: number }>(
      'SELECT COUNT(*) AS c FROM exercises WHERE module_id = ?',
      [m.id],
    ).c;
    const sub = this.db.get<{ c: number; w: number }>(
      "SELECT COUNT(*) AS c, COALESCE(SUM(word_count),0) AS w FROM submissions WHERE module_id = ?",
      [m.id],
    );
    const doneExercises = this.db.get<{ c: number }>(
      "SELECT COUNT(DISTINCT exercise_id) AS c FROM submissions WHERE module_id = ? AND status = 'done'",
      [m.id],
    ).c;
    const lessonsDone = this.db.get<{ c: number }>(
      'SELECT COUNT(*) AS c FROM lesson_progress WHERE module_id = ? AND done = 1',
      [m.id],
    ).c;
    const avg = this.db.get<{ s: number }>(
      'SELECT COALESCE(AVG(score),0) AS s FROM analyses WHERE module_id = ?',
      [m.id],
    ).s;

    let status = 'not_started';
    if (sub.c > 0) status = 'in_progress';
    if (exerciseCount > 0 && doneExercises >= exerciseCount) status = 'done';

    return {
      ...m,
      checklist: parseJson(m.checklist, []),
      dimensions: parseJson(m.dimensions, []),
      lessonCount,
      exerciseCount,
      lessonsDone,
      submissionCount: sub.c,
      words: sub.w || 0,
      doneExercises,
      avgScore: Math.round(avg || 0),
      status,
      progress:
        exerciseCount > 0
          ? Math.round((doneExercises / exerciseCount) * 100)
          : 0,
    };
  }
}
