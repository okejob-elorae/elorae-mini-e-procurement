-- Cash-flow section override. NULL means "no human override" and the
-- application deriver decides the section from posting role and account type.
ALTER TABLE `ChartAccount`
  ADD COLUMN `cashFlowSection` ENUM('KAS', 'OPERASIONAL', 'INVESTASI', 'PENDANAAN') NULL;
