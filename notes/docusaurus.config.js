// @ts-check
// See: https://docusaurus.io/docs/api/docusaurus-config

import {themes as prismThemes} from 'prism-react-renderer';
import notesIndexPlugin from './plugins/notes-index.js';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const PORTFOLIO = 'https://chiraggandhi.vercel.app';
const GITHUB = 'https://github.com/chiraggandhi123';
const LINKEDIN = 'https://linkedin.com/in/chiraggandhi123';

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: "Chirag's Notes",
  tagline: 'Notes from my AI engineering roadmap',
  favicon: 'img/logo.svg',

  // Future flags, see https://docusaurus.io/docs/api/docusaurus-config#future
  future: {
    v4: true, // Improve compatibility with the upcoming Docusaurus v4
  },

  // Production URL: name the Vercel project "chiraggandhi-notes" to get this domain.
  url: 'https://chiraggandhi-notes.vercel.app',
  baseUrl: '/',

  onBrokenLinks: 'throw',

  // .md files are plain Markdown (so `<`, `{` and <!-- comments --> just work);
  // rename a file to .mdx to use React components in it.
  markdown: {
    format: 'detect',
  },

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  stylesheets: [
    'https://fonts.googleapis.com/css2?family=Anton&family=Archivo+Black&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap',
  ],

  // Feeds the home page's stage list (src/pages/index.js).
  plugins: [notesIndexPlugin],

  themes: [
    [
      '@easyops-cn/docusaurus-search-local',
      /** @type {import('@easyops-cn/docusaurus-search-local').PluginOptions} */
      ({
        hashed: true,
        docsRouteBasePath: '/',
        indexBlog: false,
        highlightSearchTermsOnTargetPage: true,
      }),
    ],
  ],

  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          // Notes live at the site root (/rag/…); the home page is src/pages/index.js.
          routeBasePath: '/',
          sidebarPath: './sidebars.js',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      }),
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      colorMode: {
        respectPrefersColorScheme: true,
      },
      docs: {
        sidebar: {
          // Only shown in the mobile menu; desktop is sidebar-free (see custom.css).
          autoCollapseCategories: true,
        },
      },
      navbar: {
        title: "◆ Chirag's Notes",
        items: [
          {type: 'search', position: 'right'},
          {href: PORTFOLIO, label: 'Portfolio', position: 'right', className: 'navbar-portfolio'},
          {href: GITHUB, position: 'right', className: 'navbar-icon navbar-icon--github', 'aria-label': 'GitHub'},
          {href: LINKEDIN, position: 'right', className: 'navbar-icon navbar-icon--linkedin', 'aria-label': 'LinkedIn'},
        ],
      },
      footer: {
        copyright: `© ${new Date().getFullYear()} Chirag Gandhi · <a href="${PORTFOLIO}">Portfolio</a>`,
      },
      prism: {
        // Dark code blocks in both modes, like the portfolio.
        theme: prismThemes.oneDark,
        darkTheme: prismThemes.oneDark,
        additionalLanguages: ['bash', 'json', 'docker'],
      },
    }),
};

export default config;
