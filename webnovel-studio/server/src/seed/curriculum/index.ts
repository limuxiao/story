import { ModuleSeed, StageSeed } from './types';
import { genre } from './11-genre';
import { inspiration } from './01-inspiration';
import { world } from './02-world';
import { goldfinger } from './12-goldfinger';
import { character } from './03-character';
import { plot } from './04-plot';
import { outline } from './13-outline';
import { foreshadow } from './14-foreshadow';
import { conflict } from './15-conflict';
import { climax } from './05-climax';
import { immersion } from './16-immersion';
import { pacing } from './08-pacing';
import { opening } from './17-opening';
import { scene } from './06-scene';
import { dialogue } from './07-dialogue';
import { packaging } from './18-packaging';
import { practice } from './09-practice';
import { marketSense } from './19-market-sense';

export const stages: StageSeed[] = [
  {
    id: 1,
    name: '立基',
    subtitle: '选对赛道，找到值得写的世界与发动机',
    weeks: '第 1 - 5 周',
    goal: '在动笔前先把"写什么、写给谁、凭什么动人"想透：定下赛道与定位，立住核心立意，搭好能自己制造冲突的世界规则，并装上金手指这个发动机。这一阶段不过，后面全是空中楼阁。',
    focus: '每周精读 2 课 + 完成 1 个练习 + 累计练笔 2500 字',
    sortOrder: 1,
    moduleIds: ['genre', 'inspiration', 'world', 'goldfinger'],
  },
  {
    id: 2,
    name: '塑形',
    subtitle: '让人物自己走，让结构咬得住，把路看一遍',
    weeks: '第 6 - 11 周',
    goal: '造出欲望恐惧伤口俱全的人物，把事件变成因果链，画出全书三级大纲，学会埋线与造冲突。这一阶段结束时，你手头应有一份能直接开写的骨架。',
    focus: '每周精读 2 课 + 完成 1 个练习 + 完成一句话梗概与三级大纲骨架',
    sortOrder: 2,
    moduleIds: ['character', 'plot', 'outline', 'foreshadow', 'conflict'],
  },
  {
    id: 3,
    name: '生肉',
    subtitle: '把骨架填成让人放不下的活物',
    weeks: '第 12 - 18 周',
    goal: '掌握压制—释放的爽点机制与读者代入，控制松紧与章末钩子，写出能钉住人的黄金三章，让描写和对话都干着活。这一阶段决定读者通宵还是弃书。',
    focus: '每周精读 2 课 + 完成 1 个练习 + 每周至少写出 1 个完整场景段落',
    sortOrder: 3,
    moduleIds: ['climax', 'immersion', 'pacing', 'opening', 'scene', 'dialogue'],
  },
  {
    id: 4,
    name: '收魂',
    subtitle: '包装、实战、运营，然后开写',
    weeks: '第 19 - 24 周',
    goal: '把门面（书名/简介/标签）做出来，完成九宫格作品档案，建立日更与读者运营机制，并理解数据如何反哺创作。这一阶段结束，你该已经开更第一章。',
    focus: '每周精读 2 课 + 完成 1 个练习 + 填满九宫格 + 日更 2000 字',
    sortOrder: 4,
    moduleIds: ['packaging', 'practice', 'market-sense'],
  },
];

export const modules: ModuleSeed[] = [
  genre,
  inspiration,
  world,
  goldfinger,
  character,
  plot,
  outline,
  foreshadow,
  conflict,
  climax,
  immersion,
  pacing,
  opening,
  scene,
  dialogue,
  packaging,
  practice,
  marketSense,
];

export * from './types';
