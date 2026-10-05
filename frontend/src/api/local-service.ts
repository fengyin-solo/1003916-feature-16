import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type { ActionContext, ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 灾情速报的专属规则：上报即计入运营概览异常量、同一速报只能上报一次、归档后锁定、跨区域只读。
const REPORT_KEY = 'report'
const REPORT_REPORTED_STATUS = '已上报'
const REPORT_ARCHIVED_STATUS = '已归档'

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

// 筛选键支持三种后缀：「字段::from / 字段::to」按时间段界过滤（缺该字段的旧记录不进时间段结果，
// 由「字段::missing」捞进待补录）；普通键做包含匹配，数组字段（如核实结论）任一元素命中即算命中。
export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => {
      const keyword = value.trim()
      if (field.endsWith('::from')) {
        const cell = String(row[field.slice(0, -'::from'.length)] ?? '')
        return cell !== '' && cell >= keyword
      }
      if (field.endsWith('::to')) {
        const cell = String(row[field.slice(0, -'::to'.length)] ?? '')
        return cell !== '' && cell <= keyword
      }
      if (field.endsWith('::missing')) {
        return String(row[field.slice(0, -'::missing'.length)] ?? '').trim() === ''
      }
      const cell = row[field]
      if (Array.isArray(cell)) {
        return cell.some((item) => String(item).includes(keyword))
      }
      return String(cell ?? '').includes(keyword)
    }),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string, context: ActionContext = {}): ActionResult {
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
  const row = rows[index]
  const current = String(row.status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  if (key === REPORT_KEY) {
    // 跨区域速报仅可查看，核实、上报等动作一律拦截
    const region = String(row['所属区域'] ?? '')
    if (context.region && region !== '' && region !== context.region) {
      return { ok: false, message: `该${meta.entity}属于「${region}」，跨区域仅可查看` }
    }
    if (current === REPORT_ARCHIVED_STATUS) {
      return { ok: false, message: `${meta.entity}已归档，不能再${action}` }
    }
    // 同一速报只允许上报一次，重复上报不追加第二条
    if (action === '上报灾情' && (current === REPORT_REPORTED_STATUS || Boolean(row['上报时间']))) {
      return { ok: false, message: `该${meta.entity}已经上报过，不能重复上报` }
    }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...row,
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  if (key === REPORT_KEY) {
    if (action === '确认核实' && context.conclusion) {
      // 每次核实都留痕，同一速报可能积累多条核实结论
      const history = Array.isArray(row['核实结论']) ? [...(row['核实结论'] as string[])] : []
      history.push(context.conclusion)
      updated['核实结论'] = history
    }
    if (action === '上报灾情') {
      // 上报后计入运营概览异常量，并记下上报时间用于幂等判断
      updated.abnormal = true
      updated['上报时间'] = new Date().toISOString().slice(0, 10)
    }
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
    const cells = meta.fields.map((field) => {
      const cell = row[field]
      return Array.isArray(cell) ? cell.join('、') : cell ?? ''
    })
    lines.push([row.id, ...cells, row.status].join(','))
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
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      // 灾情速报一经上报即计入异常量；兼容上报动作上线前就已上报的旧记录
      abnormal: entries.filter(
        (row) => row.abnormal || (meta.key === REPORT_KEY && row.status === REPORT_REPORTED_STATUS),
      ).length,
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
