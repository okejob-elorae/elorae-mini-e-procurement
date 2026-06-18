import { forwardRef, Module } from "@nestjs/common";
import { JubelioModule } from "../jubelio.module";
import { JubelioHttpClient } from "../jubelio-http.client";
import { SalesReturnIngestService } from "./sales-return-ingest.service";
import { ReturnsSweeperService } from "./returns-sweeper.service";

@Module({
  imports: [forwardRef(() => JubelioModule)],
  providers: [JubelioHttpClient, SalesReturnIngestService, ReturnsSweeperService],
  exports: [JubelioHttpClient, SalesReturnIngestService],
})
export class ReturnsModule {}
