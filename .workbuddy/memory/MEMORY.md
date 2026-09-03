# 项目长期记忆

## 网文写作学习目标管理台（webnovel-studio）
- **用户偏好（重要）**：AI 应自主补全专业判断，不要机械照搬用户字面列举的清单。用户明确不满"你说几个我就定几个"式死板执行——给定环节样例是打样，不是画地为牢，应自行补全网文创作真正要练的能力地图。
- 框架：前端 Vite+Vue3+TS，后端 NestJS（非用户字面说的 next.ts），SQLite 在 server/data/studio.db。
- 课程数据集中在 server/src/seed/curriculum/（18 模块），导航与阶段计划均为后端动态渲染；扩展/调整环节只需改 seed 并重启后端，前端零改动。
- 本地分析器在 server/src/ai/local-analyzer.ts，按 moduleId 给维度点评；新增模块需同步补 MODULE_DIMENSION_TIPS 与 switch 分支。
- 运行：npm install → npm run install:all → npm run build → npm run dev（前端 5273 / 后端 5178）。沙箱内须用 run_in_background 持久起服务；vite 代理用 127.0.0.1 而非 localhost（IPv6 解析坑）。
