// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
	integrations: [
		starlight({
			title: 'LogScope Docs',
			logo: {
				src: './src/assets/logscope-icon.svg',
			},
			social: [
				{ icon: 'github', label: 'GitHub', href: 'https://github.com/NovelBits/logscope' },
			],
			customCss: ['./src/styles/custom.css'],
			head: [
				{ tag: 'script', content: "if(!localStorage.getItem('starlight-theme')){localStorage.setItem('starlight-theme','dark')}" },
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
					label: 'Licensing',
					items: [
						{ label: 'Free vs Pro', slug: 'licensing/free-vs-pro' },
						{ label: 'Activating a License', slug: 'licensing/activation' },
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
					],
				},
			],
		}),
	],
});
