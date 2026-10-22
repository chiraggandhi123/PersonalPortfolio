// Adds a "not written yet" stamp to pages still marked `sidebar_class_name: soon`.
import React from 'react';
import Content from '@theme-original/DocItem/Content';
import {useDoc} from '@docusaurus/plugin-content-docs/client';

export default function ContentWrapper(props) {
  const {frontMatter} = useDoc();
  const soon = /\bsoon\b/.test(frontMatter.sidebar_class_name ?? '');
  return (
    <>
      <Content {...props} />
      {soon && <span className="soon-stamp">{'// not written yet'}</span>}
    </>
  );
}
