// Replaces the default card grid on stage pages (e.g. /rag) with the same
// written/not-written list the home page uses.
import React from 'react';
import {useCurrentSidebarSiblings, filterDocCardListItems} from '@docusaurus/plugin-content-docs/client';
import NoteTree from '@site/src/components/NoteTree';

function toTree(items) {
  return filterDocCardListItems(items).map((item) =>
    item.type === 'category'
      ? {label: item.label, href: item.href, items: toTree(item.items)}
      : {label: item.label, href: item.href, soon: /\bsoon\b/.test(item.className ?? '')},
  );
}

function CurrentCategoryList() {
  return <NoteTree items={toTree(useCurrentSidebarSiblings())} />;
}

export default function DocCardList({items}) {
  return items ? <NoteTree items={toTree(items)} /> : <CurrentCategoryList />;
}
