// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
	site: 'https://docs.novelbits.io',
	base: '/logscope',
	integrations: [
		starlight({
			title: 'LogScope Docs',
			logo: {
				src: './src/assets/logscope-icon.svg',
			},
			components: {
				Sidebar: './src/components/Sidebar.astro',
				ThemeSelect: './src/components/ThemeSelect.astro',
			},
			social: [
				{ icon: 'github', label: 'GitHub', href: 'https://github.com/NovelBits/logscope' },
			],
			customCss: ['./src/styles/custom.css'],
			head: [
				{ tag: 'script', content: "if(!localStorage.getItem('starlight-theme')){localStorage.setItem('starlight-theme','dark')}" },
				{ tag: 'meta', attrs: { property: 'og:type', content: 'website' } },
				{ tag: 'meta', attrs: { property: 'og:site_name', content: 'LogScope Docs' } },
				{ tag: 'meta', attrs: { name: 'twitter:card', content: 'summary' } },
			],
			sidebar: [
				{
					label: 'Getting Started',
					items: [
						{ label: 'Overview', slug: 'getting-started/overview' },
						{ label: 'Installation', slug: 'getting-started/installation' },
						{ label: 'Connecting a Device', slug: 'getting-started/connecting' },
					],
				},
				{
					label: 'Features',
					items: [
						{ label: 'Log Viewer', slug: 'features/log-viewer' },
						{ label: 'Watch Patterns', slug: 'features/watch-patterns' },
						{ label: 'HCI Packet Decoding', slug: 'features/hci-decoding' },
						{ label: 'Filtering & Search', slug: 'features/filtering' },
						{ label: 'Export', slug: 'features/export' },
					],
				},
				{
					label: 'Releases',
					items: [{ autogenerate: { directory: 'releases' } }],
					collapsed: true,
				},
				{
					label: 'Licensing',
					items: [
						{ label: 'Licensing', slug: 'licensing/free-vs-pro' },
					],
				},
				{
					label: 'Demo Firmware',
					items: [
						{ label: 'BLE HCI Demo (nRF54L15)', slug: 'demo/ble-hci-demo' },
						{ label: 'Generic Zephyr Demo', slug: 'demo/generic-zephyr' },
						{ label: 'Supported Boards', slug: 'demo/supported-boards' },
					],
				},
				{
					label: 'Reference',
					items: [
						{ label: 'Settings', slug: 'reference/settings' },
						{ label: 'Commands', slug: 'reference/commands' },
						{ label: 'Troubleshooting', slug: 'reference/troubleshooting' },
						{ label: 'Privacy & Telemetry', slug: 'reference/privacy-telemetry' },
						{ label: 'FAQ', slug: 'reference/faq' },
					],
				},
			],
		}),
		sitemap(),
	],
});
