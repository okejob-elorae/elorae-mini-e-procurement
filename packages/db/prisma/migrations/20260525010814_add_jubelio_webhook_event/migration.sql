-- CreateTable
CREATE TABLE `JubelioWebhookEvent` (
    `id` VARCHAR(191) NOT NULL,
    `event` VARCHAR(191) NOT NULL,
    `eventId` VARCHAR(191) NULL,
    `signature` TEXT NOT NULL,
    `payloadHash` VARCHAR(191) NOT NULL,
    `rawPayload` JSON NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'RECEIVED',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `lastError` TEXT NULL,
    `receivedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `processedAt` DATETIME(3) NULL,

    UNIQUE INDEX `JubelioWebhookEvent_event_payloadHash_key`(`event`, `payloadHash`),
    INDEX `JubelioWebhookEvent_status_receivedAt_idx`(`status`, `receivedAt`),
    INDEX `JubelioWebhookEvent_event_receivedAt_idx`(`event`, `receivedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
