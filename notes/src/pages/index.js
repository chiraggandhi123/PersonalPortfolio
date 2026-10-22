import React from 'react';
import Layout from '@theme/Layout';
import Link from '@docusaurus/Link';
import {usePluginData} from '@docusaurus/useGlobalData';
import NoteTree, {countNotes, plainLabel} from '@site/src/components/NoteTree';
import styles from './index.module.css';

export default function Home() {
  const {items} = usePluginData('notes-index');
  const stages = items.filter((item) => item.items);
  const pages = items.filter((item) => !item.items);
  const {written, total} = countNotes(stages);

  return (
    <Layout title="The AI Engineer Roadmap" description="Notes from my AI engineering roadmap">
      <main className={styles.home}>
        <div className={styles.label}>
          <span className={styles.labelNum}>§</span>
          <span className={styles.rule} />
          Notes · Chirag Gandhi
        </div>
        <h1 className={styles.title}>The AI Engineer Roadmap</h1>
        <div className={styles.meta}>
          {stages.length} stages · {total} notes · {written} written
        </div>
        <div className={styles.progress} aria-hidden="true">
          <span style={{width: `${total ? (written / total) * 100 : 0}%`}} />
        </div>
        <nav className={styles.links} aria-label="Pages">
          {pages.map((page) => (
            <Link key={page.href} to={page.href}>
              {plainLabel(page.label)}
            </Link>
          ))}
        </nav>

        <ol className={styles.stages}>
          {stages.map((stage, i) => {
            const count = countNotes(stage.items);
            return (
              <li key={stage.label}>
                <details className={styles.stage}>
                  <summary>
                    <span className={styles.num}>{String(i).padStart(2, '0')}</span>
                    <span className={styles.stageTitle}>{stage.label.replace(/^\d+\s*·\s*/, '')}</span>
                    <span className={styles.count}>
                      {count.written}/{count.total}
                    </span>
                  </summary>
                  <div className={styles.stageBody}>
                    <NoteTree items={stage.items} />
                  </div>
                </details>
              </li>
            );
          })}
        </ol>
      </main>
    </Layout>
  );
}
