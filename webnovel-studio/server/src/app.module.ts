import { Module, OnModuleInit } from '@nestjs/common';
import { DatabaseService } from './db/database.service';
import { SeedService } from './seed/seed.service';
import { AiService } from './ai/ai.service';
import { CurriculumController } from './modules/curriculum.controller';
import { PracticeController } from './modules/practice.controller';
import { WorksController } from './modules/works.controller';
import { SystemController } from './modules/system.controller';

@Module({
  controllers: [
    CurriculumController,
    PracticeController,
    WorksController,
    SystemController,
  ],
  providers: [DatabaseService, SeedService, AiService],
})
export class AppModule implements OnModuleInit {
  constructor(private seed: SeedService) {}
  onModuleInit() {
    this.seed.run();
  }
}
