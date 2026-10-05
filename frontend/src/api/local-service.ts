import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type {
  ActionResult,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
  ReportQuery,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

const REPORT_KEY = 'report'
const REPORT_TIME_FIELD = '发生时间'
const REPORT_VERDICTS_FIELD = '核实结论集'

// 核实结论固定四档；同一条速报命中多个结论时，按下标靠前（优先级高）的结论展示。
export const VERDICTS = ['灾情属实', '部分属实', '险情排除', '信息误报']

export function verdictSet(row: EntryRow): string[] {
  const value = row[REPORT_VERDICTS_FIELD]
  return Array.isArray(value) ? value : []
}

// 多个结论时的展示优先级：灾情属实 > 部分属实 > 险情排除 > 信息误报。
export function primaryVerdict(row: EntryRow): string {
  const hit = verdictSet(row)
  return VERDICTS.find((verdict) => hit.includes(verdict)) ?? ''
}

export function isCrossRegion(row: EntryRow, region: string): boolean {
  return String(row['所属区域'] ?? '') !== region
}

// 旧记录缺发生时间的，统一进入「待补录」；列表、核实动作、运营概览三条路径都先过这里。
export function normalizeReportRows(persist = true): EntryRow[] {
  const rows = listRows(REPORT_KEY)
  let changed = false
  const normalized = rows.map((row) => {
    const hasTime = String(row[REPORT_TIME_FIELD] ?? '').trim() !== ''
    if (!hasTime && row.status !== '待补录') {
      changed = true
      return { ...row, status: '待补录', pending: true, '速报状态': '待补录' }
    }
    return row
  })
  if (changed && persist) {
    saveRows(REPORT_KEY, normalized)
  }
  return normalized
}

// 灾情速报的组合检索：发生时间段、灾害类型、受灾范围、核实结论可同时生效。
export function listReports(query: Partial<ReportQuery> = {}): PageResult {
  const rows = normalizeReportRows()
  const startTime = query.startTime?.trim() ?? ''
  const endTime = query.endTime?.trim() ?? ''
  const disasterType = query.disasterType?.trim() ?? ''
  const affectedArea = query.affectedArea?.trim() ?? ''
  const verdict = query.verdict?.trim() ?? ''
  const matched = rows.filter((row) => {
    const occurredAt = String(row[REPORT_TIME_FIELD] ?? '').trim()
    // 发生时间缺失的记录不进时间段结果，只能去待补录里补。
    if (startTime && (!occurredAt || occurredAt < startTime)) {
      return false
    }
    if (endTime && (!occurredAt || occurredAt > endTime)) {
      return false
    }
    if (disasterType && String(row['灾害类型'] ?? '') !== disasterType) {
      return false
    }
    if (affectedArea && !String(row['受灾范围'] ?? '').includes(affectedArea)) {
      return false
    }
    if (verdict && !verdictSet(row).includes(verdict)) {
      return false
    }
    return true
  })
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

type ReportActionPayload = {
  region: string
  occurrenceTime?: string
  verdict?: string
}

// 速报核实动作的专用取数路径：管跨区域只读、状态流转、结论累计和异常量追加。
export function runReportAction(
  id: number,
  action: string,
  payload: ReportActionPayload,
): ActionResult {
  const rows = normalizeReportRows()
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的灾情速报` }
  }
  const current = rows[index]
  // 跨区域速报只能查看，任何动作都不落到对方数据上。
  if (isCrossRegion(current, payload.region)) {
    return { ok: false, message: '跨区域灾情速报只能查看，不能执行核实或上报动作' }
  }
  const status = String(current.status)
  let updated: EntryRow | null = null

  if (action === '补充发生时间') {
    if (status !== '待补录') {
      return { ok: false, message: '只有待补录的速报需要补充发生时间' }
    }
    const occurredAt = payload.occurrenceTime?.trim() ?? ''
    if (!occurredAt) {
      return { ok: false, message: '请填写发生时间后再提交' }
    }
    updated = { ...current, [REPORT_TIME_FIELD]: occurredAt, status: '已录入', pending: true }
  } else if (action === '提交核实') {
    if (status !== '已录入') {
      return { ok: false, message: '只有已录入的速报能提交核实' }
    }
    updated = { ...current, status: '待核实', pending: true }
  } else if (action === '确认核实') {
    if (status !== '待核实' && status !== '已核实') {
      return { ok: false, message: '只有待核实的速报能确认核实结论' }
    }
    const verdict = payload.verdict?.trim() ?? ''
    if (!VERDICTS.includes(verdict)) {
      return { ok: false, message: '请选择核实结论' }
    }
    const verdicts = verdictSet(current)
    const nextVerdicts = verdicts.includes(verdict) ? verdicts : [...verdicts, verdict]
    updated = { ...current, [REPORT_VERDICTS_FIELD]: nextVerdicts, status: '已核实', pending: true }
  } else if (action === '上报灾情') {
    if (status === '已上报' || status === '已归档') {
      // 同一条速报重复上报直接拦住，异常量不追加第二条。
      return { ok: false, message: '该灾情速报已上报，不能重复上报' }
    }
    if (status !== '已核实') {
      return { ok: false, message: '只有已核实的速报能上报灾情' }
    }
    // 提交上报后，运营概览的异常量追加一次；重复上报进不来这里。
    updated = { ...current, status: '已上报', pending: false, abnormal: true }
  } else if (action === '归档') {
    if (status !== '已上报') {
      return { ok: false, message: '只有已上报的速报能归档' }
    }
    // 归档保留已追加的异常量，不再追加。
    updated = { ...current, status: '已归档', pending: false, abnormal: current.abnormal }
  } else {
    return { ok: false, message: `灾情速报没有登记「${action}」这个动作` }
  }

  updated['速报状态'] = updated.status
  const next = [...rows]
  next[index] = updated
  saveRows(REPORT_KEY, next)
  return { ok: true, message: `灾情速报已${action}，当前状态「${updated.status}」` }
}

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  // 灾情速报有自己的组合检索路径（listReports），通用入口也先做缺发生时间归一化。
  if (key === REPORT_KEY) {
    normalizeReportRows()
  }
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  // 灾情速报的核实动作走 runReportAction（跨区域、重复上报、异常量都在那边管）。
  if (key === REPORT_KEY) {
    return { ok: false, message: '灾情速报动作请走灾情速报专用核实通道' }
  }
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  // 运营概览取数同样先归一化速报：缺发生时间的旧记录进待补录，已上报的异常量才统计得到。
  normalizeReportRows()
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
