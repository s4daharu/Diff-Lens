import type { DiffRow, RowKind } from './types';

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
  return sections;
}
