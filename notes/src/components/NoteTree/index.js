import React from 'react';
import Link from '@docusaurus/Link';
import styles from './styles.module.css';

// Items are {label, href, soon} notes or {label, href, items} groups,
// as published by plugins/notes-index.js.

export function countNotes(items) {
  return items.reduce(
    (acc, item) => {
      if (item.items) {
        const sub = countNotes(item.items);
        return {written: acc.written + sub.written, total: acc.total + sub.total};
      }
      return {written: acc.written + (item.soon ? 0 : 1), total: acc.total + 1};
    },
    {written: 0, total: 0},
  );
}

// Strips a leading emoji so labels read cleanly in the mono/uppercase styles.
export function plainLabel(label) {
  return label.replace(/^[^\p{L}\p{N}]+/u, '');
}

export default function NoteTree({items}) {
  // Keep sidebar order: runs of notes become one list, groups get a label.
  const blocks = [];
  items.forEach((item) => {
    if (item.items) {
      blocks.push(item);
    } else if (Array.isArray(blocks[blocks.length - 1])) {
      blocks[blocks.length - 1].push(item);
    } else {
      blocks.push([item]);
    }
  });

  return (
    <div className={styles.tree}>
      {blocks.map((block, i) =>
        Array.isArray(block) ? (
          <ul className={styles.notes} key={i}>
            {block.map((note) => (
              <li key={note.href} className={note.soon ? styles.soon : styles.written}>
                <Link to={note.href}>{plainLabel(note.label)}</Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className={styles.group} key={block.label}>
            <div className={styles.groupLabel}>
              {block.label}
              <span>
                {countNotes(block.items).written}/{countNotes(block.items).total}
              </span>
            </div>
            <NoteTree items={block.items} />
          </div>
        ),
      )}
    </div>
  );
}
