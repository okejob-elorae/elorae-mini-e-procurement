import { Controller, HttpCode, Param, Post } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { OutboxPoller } from "./outbox-poller.service";

@ApiTags("jubelio-outbox")
@Controller("jubelio/outbox")
export class JubelioOutboxController {
  constructor(private readonly poller: OutboxPoller) {}

  @Post("enqueue/:rowId")
  @HttpCode(200)
  @ApiOperation({
    summary: "Enqueue an existing JubelioOutbox row for immediate processing",
    description:
      "Called by apps/web after inserting an outbox row to skip the 5s poller delay. " +
      "Idempotent at the BullMQ level via jobId=rowId. The poller is the safety net if " +
      "this call fails.",
  })
  async enqueue(@Param("rowId") rowId: string): Promise<{ ok: boolean }> {
    await this.poller.enqueueById(rowId);
    return { ok: true };
  }
}
