import { writable } from 'svelte/store';

/** 极简离线 hash 路由：#/editor 与 #/puzzle，无需服务器 fallback 配置。 */
export type Route = 'editor' | 'puzzle';

function parse(): Route {
  const h = location.hash.replace(/^#/, '');
  return h.startsWith('/puzzle') ? 'puzzle' : 'editor';
}

export const route = writable<Route>(parse());

window.addEventListener('hashchange', () => route.set(parse()));

export function goto(r: Route): void {
  location.hash = `/${r}`;
}
