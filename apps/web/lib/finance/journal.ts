type JournalLine = { accountCode: string; debit: number; credit: number };

export async function generateAutoJournal(
  _eventType: string,
  _refId: string,
  _lines: JournalLine[],
): Promise<void> {
  // EPIC-13 auto-journal not shipped — callers degrade gracefully via dynamic import.
}
