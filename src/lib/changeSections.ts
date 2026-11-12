import type { DiffRow, MoveRole, RowKind } from './types';

export type ChangeSectionKind = Exclude<RowKind, 'equal' | 'gap'> | 'mixed';

export interface ChangeSection {
  rowIndex: number;
  endRowIndex: number;
  kind: ChangeSectionKind;
  oldNum: number | null;
  oldEndNum: number | null;
  newNum: number | null;
  newEndNum: number | null;
  count: number;
  oldStartLine: number;
  oldEndLine: number;
  newStartLine: number;
  newEndLine: number;
  moveId?: number;
  moveRole?: MoveRole;
  moveSimilarity?: number;
  moveExact?: boolean;
  movePeerRowIndex?: number;
}

export function buildChangeSections(
  rows: DiffRow[],
  sourceRows: DiffRow[] = rows,
): ChangeSection[] {
  const sections: ChangeSection[] = [];
  let current: ChangeSection | null = null;

  const finish = () => {
    if (current) sections.push(current);
    current = null;
  };

  rows.forEach((row, rowIndex) => {
    if (row.kind === 'equal' || row.kind === 'gap') {
      finish();
      return;
    }

    if (
      current &&
      (current.moveId !== row.moveId || current.moveRole !== row.moveRole)
    ) {
      finish();
    }

    if (!current) {
      current = {
        rowIndex,
        endRowIndex: rowIndex,
        kind: row.kind,
        oldNum: row.oldNum,
        oldEndNum: row.oldNum,
        newNum: row.newNum,
        newEndNum: row.newNum,
        count: 1,
        oldStartLine: 0,
        oldEndLine: 0,
        newStartLine: 0,
        newEndLine: 0,
        moveId: row.moveId,
        moveRole: row.moveRole,
        moveSimilarity: row.moveSimilarity,
        moveExact: row.moveExact,
      };
      return;
    }

    current.endRowIndex = rowIndex;
    current.count += 1;
    if (current.kind !== row.kind) current.kind = 'mixed';
    if (current.oldNum == null && row.oldNum != null) current.oldNum = row.oldNum;
    if (row.oldNum != null) current.oldEndNum = row.oldNum;
    if (current.newNum == null && row.newNum != null) current.newNum = row.newNum;
    if (row.newNum != null) current.newEndNum = row.newNum;
  });

  finish();

  const sourceIndexByRow = new Map<DiffRow, number>();
  sourceRows.forEach((row, index) => sourceIndexByRow.set(row, index));

  const insertionPoint = (
    sourceStart: number,
    sourceEnd: number,
    key: 'oldNum' | 'newNum',
  ): number => {
    for (let index = sourceStart - 1; index >= 0; index--) {
      const line = sourceRows[index]?.[key];
      if (line != null) return line;
    }
    for (let index = sourceEnd + 1; index < sourceRows.length; index++) {
      const line = sourceRows[index]?.[key];
      if (line != null) return Math.max(0, line - 1);
    }
    return 0;
  };

  for (const section of sections) {
    const firstRow = rows[section.rowIndex];
    const lastRow = rows[section.endRowIndex];
    const sourceStart = sourceIndexByRow.get(firstRow) ?? section.rowIndex;
    const sourceEnd = sourceIndexByRow.get(lastRow) ?? sourceStart;

    if (section.oldNum != null && section.oldEndNum != null) {
      section.oldStartLine = section.oldNum - 1;
      section.oldEndLine = section.oldEndNum;
    } else {
      const point = insertionPoint(sourceStart, sourceEnd, 'oldNum');
      section.oldStartLine = point;
      section.oldEndLine = point;
    }

    if (section.newNum != null && section.newEndNum != null) {
      section.newStartLine = section.newNum - 1;
      section.newEndLine = section.newEndNum;
    } else {
      const point = insertionPoint(sourceStart, sourceEnd, 'newNum');
      section.newStartLine = point;
      section.newEndLine = point;
    }
  }

  const movedById = new Map<number, ChangeSection[]>();
  for (const section of sections) {
    if (section.moveId == null) continue;
    const list = movedById.get(section.moveId) ?? [];
    list.push(section);
    movedById.set(section.moveId, list);
  }
  for (const section of sections) {
    if (section.moveId == null || section.moveRole == null) continue;
    const peers = movedById.get(section.moveId);
    const peer = peers?.find((candidate) => candidate.moveRole !== section.moveRole);
    if (peer) section.movePeerRowIndex = peer.rowIndex;
  }

  return sections;
}
