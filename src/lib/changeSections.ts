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
  moveId?: number;
  moveRole?: MoveRole;
  moveSimilarity?: number;
  moveExact?: boolean;
  movePeerRowIndex?: number;
}

export function buildChangeSections(rows: DiffRow[]): ChangeSection[] {
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
