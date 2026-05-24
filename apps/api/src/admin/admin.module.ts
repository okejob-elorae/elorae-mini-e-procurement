import { Global, Module } from "@nestjs/common";
import { AdminNotificationService } from "./notification.service";

@Global()
@Module({
  providers: [AdminNotificationService],
  exports: [AdminNotificationService],
})
export class AdminModule {}
