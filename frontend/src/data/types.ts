/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  // 灾情速报的「核实结论集」是数组：同一速报可命中多个核实结论。
  [field: string]: string | number | boolean | string[]
}

// 灾情速报的组合查询条件：发生时间段 + 灾害类型 + 受灾范围 + 核实结论。
export type ReportQuery = {
  startTime: string
  endTime: string
  disasterType: string
  affectedArea: string
  verdict: string
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
