// Synthetic fixtures for the gradreq tests. Invented codes only; nothing here comes from the real dataset.
import type { GradGroup, GradMember, GradView, LoadedView, ViewKind } from './types';

export const member = (code: string | null, o: Partial<GradMember> = {}): GradMember => ({ code, title: code ?? 'Untitled', cus: 1, cls: 'rule', ...o });

export const group = (id: string, o: Partial<GradGroup> = {}): GradGroup => ({
  id, name: id, type: 'basket', role: 'additive', cus: 1, minCourses: null, missingList: false, members: [], ...o,
});

export const view = (id: string, groups: GradGroup[], o: Partial<GradView> = {}): GradView => ({
  id, label: id, intakeFrom: 'AY2025/26', intakeTo: 'AY2026/27', openEnded: true, totalCus: 0, basis: 'stated', groups, ...o,
});

export const loaded = (kind: ViewKind, v: GradView): LoadedView => ({ kind, view: v });

export const codes = (...cs: string[]): GradMember[] => cs.map((c) => member(c));
