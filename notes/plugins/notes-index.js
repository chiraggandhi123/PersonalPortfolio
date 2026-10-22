// Publishes the docs sidebar as a plain tree ({label, href, soon, items}) so the
// home page can list every stage and note without hard-coding them. A note is
// "soon" (not written yet) while its front matter has `sidebar_class_name: soon`.

function toTree(items, docsById) {
  return items.flatMap((item) => {
    if (item.type === 'doc' || item.type === 'ref') {
      const doc = docsById.get(item.id);
      if (!doc) return [];
      return [
        {
          label: item.label ?? doc.frontMatter.sidebar_label ?? doc.title,
          href: doc.permalink,
          soon: /\bsoon\b/.test(item.className ?? ''),
        },
      ];
    }
    if (item.type === 'category') {
      const link = item.link?.type === 'doc' ? docsById.get(item.link.id)?.permalink : item.link?.permalink;
      return [{label: item.label, href: link ?? null, items: toTree(item.items, docsById)}];
    }
    return [];
  });
}

export default function notesIndexPlugin() {
  return {
    name: 'notes-index',
    async allContentLoaded({allContent, actions}) {
      const [version] = allContent['docusaurus-plugin-content-docs'].default.loadedVersions;
      const docsById = new Map(version.docs.map((doc) => [doc.id, doc]));
      actions.setGlobalData({items: toTree(version.sidebars.notesSidebar, docsById)});
    },
  };
}
