// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import PuzzlePage from './PuzzlePage.svelte';
import { serialize } from '../lib/stores/boardStore';
import { block2x2, block2x3 } from '../lib/testing/testBoards';
import type { Board } from '../lib/types';

/**
 * 谜题页“安全提示”的页面级测试：
 * 多解（暂无线索 / 预览并确认）、矛盾（不清空输入）、超限（未知）、编辑后失效。
 */

const STORAGE_KEY = 'kakuro-published-board';

function publish(board: Board): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(serialize(board)));
}

const hintButton = () => screen.getByRole('button', { name: '安全提示' });
const inputAt = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

beforeEach(() => {
  localStorage.clear();
});
afterEach(cleanup);

describe('谜题页 · 安全提示', () => {
  it('多解且没有必然格：明确显示暂无线索，不提供填入按钮', async () => {
    publish(block2x3([6, 9, 5, 5, 5])); // 6 个解，没有任何格被所有解强制
    render(PuzzlePage);
    await fireEvent.click(hintButton());
    expect(screen.getByText(/暂无线索/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '填入' })).toBeNull();
  });

  it('多解但存在必然格：只预览，确认后才写入，高亮格即提示格', async () => {
    publish(block2x3([8, 13, 3, 7, 11])); // 3 个解，但 a（第2行第2列）恒为 1
    render(PuzzlePage);
    const input = inputAt('第2行第2列');
    await fireEvent.click(hintButton());

    // 预览：横幅 + 高亮 + 残影都来自同一份结果，输入框仍未变
    expect(screen.getByText(/第 2 行第 2 列可以填/)).toBeTruthy();
    expect(input.value).toBe('');
    expect(input.closest('td')!.classList.contains('hinted')).toBe(true);

    await fireEvent.click(screen.getByRole('button', { name: '填入' }));
    expect(input.value).toBe('1'); // 确认后才真正填入
    expect(screen.queryByText(/可以填/)).toBeNull(); // 面板随之关闭
  });

  it('填写矛盾：只提示局面矛盾，绝不清空玩家输入', async () => {
    render(PuzzlePage); // 内置示例：唯一解 [1,2,3,1]
    const a = inputAt('第2行第2列');
    const b = inputAt('第2行第3列');
    await fireEvent.input(a, { target: { value: '1' } });
    await fireEvent.input(b, { target: { value: '1' } }); // 同一横线两个 1
    await fireEvent.click(hintButton());
    expect(screen.getByText(/矛盾/)).toBeTruthy();
    expect(a.value).toBe('1'); // 输入保持原样
    expect(b.value).toBe('1');
    expect(screen.queryByRole('button', { name: '填入' })).toBeNull();
  });

  it('搜索超限：如实显示未知，而不是编造提示', async () => {
    publish(block2x2([3, 3, 3, 3]));
    render(PuzzlePage, { props: { hintNodeLimit: 1 } });
    await fireEvent.click(hintButton());
    expect(screen.getByText(/触及上限/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '填入' })).toBeNull();
  });

  it('任一已填数字变化立即使旧提示失效', async () => {
    render(PuzzlePage); // 内置示例
    await fireEvent.click(hintButton());
    expect(screen.getByText(/可以填/)).toBeTruthy();
    await fireEvent.input(inputAt('第2行第3列'), { target: { value: '2' } });
    expect(screen.queryByText(/可以填/)).toBeNull();
  });

  it('棋盘变化同样立即使旧提示失效', async () => {
    publish(block2x3([8, 13, 3, 7, 11]));
    render(PuzzlePage);
    await fireEvent.click(hintButton());
    expect(screen.getByText(/可以填/)).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: '内置示例' }));
    expect(screen.queryByText(/可以填/)).toBeNull();
  });
});
