// 灾情速报的取数门面：速报列表、核实动作、运营概览用到的速报能力都从这里出，
// 实现仍在 local-service 里，和其他模块共用同一份本地数据。
export {
  VERDICTS,
  downloadEntries,
  isCrossRegion,
  listReports,
  normalizeReportRows,
  primaryVerdict,
  runReportAction,
  verdictSet,
} from './local-service'
import { listRows } from '@/data/local-store'
import type { EntryRow } from '@/data/types'

export function listRowsAll(): EntryRow[] {
  return listRows('report')
}
