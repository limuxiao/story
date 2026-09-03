export interface LessonSeed {
  title: string;
  summary: string;
  body: string[];
  keypoints: string[];
  pitfalls: string[];
  drill: string;
  readMinutes: number;
}

export interface ExerciseSeed {
  title: string;
  prompt: string;
  requirements: string[];
  minWords: number;
  reference?: string;
  rubric: string[];
}

export interface ModuleSeed {
  id: string;
  title: string;
  subtitle: string;
  stage: number;
  sortOrder: number;
  goal: string;
  overview: string;
  checklist: string[];
  dimensions: string[];
  targetWords: number;
  icon: string;
  lessons: LessonSeed[];
  exercises: ExerciseSeed[];
}

export interface StageSeed {
  id: number;
  name: string;
  subtitle: string;
  weeks: string;
  goal: string;
  focus: string;
  sortOrder: number;
  moduleIds: string[];
}
