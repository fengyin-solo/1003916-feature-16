<template>
  <section class="page" data-module="report">
    <header class="page-head">
      <div>
        <h2>灾情速报管理</h2>
        <p class="page-desc">维护灾情速报，围绕发生时间段、灾害类型、受灾范围和核实结论组合检索，并在结果中定位待核实、已上报、已归档记录。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记灾情速报</button>
        <button class="btn" type="button" @click="exportRows">导出灾情速报清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>发生时间起</span>
        <input v-model="query.startTime" type="date" />
      </label>
      <label class="filter-item">
        <span>发生时间止</span>
        <input v-model="query.endTime" type="date" />
      </label>
      <label class="filter-item">
        <span>灾害类型</span>
        <select v-model="query.disasterType">
          <option value="">全部类型</option>
          <option v-for="item in disasterTypes" :key="item" :value="item">{{ item }}</option>
        </select>
      </label>
      <label class="filter-item">
        <span>受灾范围</span>
        <input v-model="query.affectedArea" placeholder="按乡镇/村组检索" />
      </label>
      <label class="filter-item">
        <span>核实结论</span>
        <select v-model="query.verdict">
          <option value="">全部结论</option>
          <option v-for="item in VERDICTS" :key="item" :value="item">{{ item }}</option>
        </select>
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <p class="status-legend locator-bar">
      <button
        v-for="item in locators"
        :key="item.status"
        class="legend-item locator-chip"
        :class="{ active: activeLocator === item.status, disabled: item.count === 0 }"
        type="button"
        :disabled="item.count === 0"
        @click="locate(item.status)"
      >
        {{ item.status }} {{ item.count }} 条{{ item.count ? '（点击定位）' : '' }}
      </button>
      <span class="locator-hint">其余状态：</span>
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>核实结论</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in rows"
          :key="String(row.id)"
          :ref="(el) => bindRowEl(el, Number(row.id))"
          :class="{ 'flash-row': flashId === Number(row.id), 'cross-row': isCross(row) }"
        >
          <td>{{ formatCell(row["速报编号"]) }}</td>
          <td>{{ formatCell(row["隐患点编号"]) }}</td>
          <td :class="{ 'need-fill': !occurredAt(row) }">
            {{ occurredAt(row) || '待补录' }}
          </td>
          <td>{{ formatCell(row["灾害类型"]) }}</td>
          <td>{{ formatCell(row["受灾范围"]) }}</td>
          <td>{{ formatCell(row["所属区域"]) }}<span v-if="isCross(row)" class="cross-tag">跨区</span></td>
          <td>{{ formatCell(row["伤亡人数"]) }}</td>
          <td>{{ formatCell(row["经济损失"]) }}</td>
          <td>
            <template v-if="verdictText(row)">
              <span class="verdict-text">{{ verdictText(row) }}</span>
            </template>
            <template v-else>—</template>
          </td>
          <td>
            <span class="status-pill" :class="`st-${String(row.status)}`">{{ row.status }}</span>
          </td>
          <td class="row-actions">
            <template v-if="isCross(row)">
              <span class="readonly-text">跨区只读</span>
            </template>
            <template v-else>
              <button
                v-for="action in availableActions(row)"
                :key="action"
                class="link"
                type="button"
                @click="runAction(action, row)"
              >
                {{ action }}
              </button>
              <span v-if="availableActions(row).length === 0" class="readonly-text">—</span>
            </template>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">没有符合查询条件的灾情速报</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条灾情速报记录 · 当前值班区域：{{ session.region }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <div v-if="verifyModal.open" class="modal-mask" @click.self="closeVerify">
      <div class="modal-card">
        <h3>确认核实结论</h3>
        <p class="modal-tip">
          速报 {{ formatCell(verifyModal.row?.["速报编号"]) }}；同一速报可累计多个结论，展示取最高优先级。
        </p>
        <label class="modal-field">
          <span>核实结论</span>
          <select v-model="verifyModal.verdict">
            <option value="" disabled>请选择结论</option>
            <option v-for="item in VERDICTS" :key="item" :value="item">{{ item }}</option>
          </select>
        </label>
        <p v-if="existingVerdicts.length" class="modal-tip">
          已登记结论：{{ existingVerdicts.join('、') }}
        </p>
        <p v-if="verifyModal.error" class="error-text">{{ verifyModal.error }}</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="closeVerify">取消</button>
          <button class="btn primary" type="button" @click="submitVerify">提交核实结论</button>
        </div>
      </div>
    </div>

    <div v-if="fillModal.open" class="modal-mask" @click.self="closeFill">
      <div class="modal-card">
        <h3>补充发生时间</h3>
        <p class="modal-tip">
          速报 {{ formatCell(fillModal.row?.["速报编号"]) }} 缺发生时间，补齐后回到已录入继续核实。
        </p>
        <label class="modal-field">
          <span>发生时间</span>
          <input v-model="fillModal.time" type="date" />
        </label>
        <p v-if="fillModal.error" class="error-text">{{ fillModal.error }}</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="closeFill">取消</button>
          <button class="btn primary" type="button" @click="submitFill">保存补录</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  VERDICTS,
  downloadEntries,
  isCrossRegion,
  listReports,
  listRowsAll,
  normalizeReportRows,
  primaryVerdict,
  runReportAction,
  verdictSet,
} from '@/api/report-service'
import { useSessionStore } from '@/stores/session'
import type { EntryRow, ReportQuery } from '@/data/types'

const session = useSessionStore()

const columns = ["速报编号", "隐患点编号", "发生时间", "灾害类型", "受灾范围", "所属区域", "伤亡人数", "经济损失"]
const LOCATOR_STATUSES = ["待核实", "已上报", "已归档"]
const ALL_STATUSES = ["已录入", "待补录", "待核实", "已核实", "已上报", "已归档"]
const QUERY_KEY = 'geohazard-monitor-prevention:report-query'

const emptyQuery = (): ReportQuery => ({
  startTime: '',
  endTime: '',
  disasterType: '',
  affectedArea: '',
  verdict: '',
})

function readQuery(): ReportQuery {
  const base = emptyQuery()
  if (typeof window === 'undefined' || !window.localStorage) {
    return base
  }
  try {
    const raw = window.localStorage.getItem(QUERY_KEY)
    if (raw) {
      return { ...base, ...(JSON.parse(raw) as Partial<ReportQuery>) }
    }
  } catch {
    // 查询条件坏了就回到空条件，不影响列表打开。
  }
  return base
}

const rows = ref<EntryRow[]>([])
const allRows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const query = reactive<ReportQuery>(readQuery())
const flashId = ref<number | null>(null)
const activeLocator = ref('')
const rowEls = new Map<number, HTMLElement>()
const locatorCursor = new Map<string, number>()
let flashTimer: ReturnType<typeof setTimeout> | undefined

// 灾害类型从全部速报里取，换数据也不用改页面。
const disasterTypes = computed(() => {
  const types = allRows.value
    .map((row) => String(row['灾害类型'] ?? '').trim())
    .filter(Boolean)
  return [...new Set(types)]
})

// 顶部指标始终按全部速报算，不受查询条件影响。
const stats = computed(() => {
  const all = allRows.value
  const month = latestMonth(all)
  return [
    { label: `本月速报数（${month}）`, value: all.filter((row) => occurredAt(row).startsWith(month)).length },
    { label: '已核实数', value: all.filter((row) => ['已核实', '已上报', '已归档'].includes(String(row.status))).length },
    { label: '待上报数', value: all.filter((row) => String(row.status) === '已核实').length },
  ]
})

const locators = computed(() =>
  LOCATOR_STATUSES.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const statusSummary = computed(() =>
  ALL_STATUSES.filter((status) => !LOCATOR_STATUSES.includes(status)).map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function latestMonth(all: EntryRow[]): string {
  const times = all.map((row) => occurredAt(row)).filter(Boolean).sort()
  const newest = times[times.length - 1] ?? ''
  return newest.slice(0, 7)
}

function occurredAt(row: EntryRow): string {
  return String(row['发生时间'] ?? '').trim()
}

function formatCell(value: unknown): string {
  if (value === undefined || value === null || value === '') {
    return '—'
  }
  return String(value)
}

function isCross(row: EntryRow): boolean {
  return isCrossRegion(row, session.region)
}

// 多个结论的展示：主结论（高优先级）+ 其余结论条数。
function verdictText(row: EntryRow): string {
  const hit = verdictSet(row)
  if (hit.length === 0) {
    return ''
  }
  const primary = primaryVerdict(row)
  return hit.length > 1 ? `${primary} +${hit.length - 1}` : primary
}

function availableActions(row: EntryRow): string[] {
  switch (String(row.status)) {
    case '待补录':
      return ['补充发生时间']
    case '已录入':
      return ['提交核实']
    case '待核实':
      return ['确认核实']
    case '已核实':
      return ['确认核实', '上报灾情']
    case '已上报':
      return ['归档']
    default:
      return []
  }
}

function bindRowEl(el: unknown, id: number) {
  if (el instanceof HTMLElement) {
    rowEls.set(id, el)
  } else {
    rowEls.delete(id)
  }
}

// 在当前查询结果里定位：重复点击同一状态时逐条往下跳。
function locate(status: string) {
  const matched = rows.value.filter((row) => String(row.status) === status)
  if (!matched.length) {
    return
  }
  const cursor = (locatorCursor.get(status) ?? -1) + 1
  const target = matched[cursor % matched.length]
  locatorCursor.set(status, cursor % matched.length)
  activeLocator.value = status
  const el = rowEls.get(Number(target.id))
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
  flashId.value = Number(target.id)
  if (flashTimer) {
    clearTimeout(flashTimer)
  }
  flashTimer = setTimeout(() => {
    flashId.value = null
  }, 1800)
}

function persistQuery() {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(QUERY_KEY, JSON.stringify(query))
  }
}

function reload() {
  errorMessage.value = ''
  try {
    allRows.value = listRowsAll()
    const payload = listReports(query)
    rows.value = payload.items
    total.value = payload.total
    // 结果集变了，定位游标从头再来。
    locatorCursor.clear()
    activeLocator.value = ''
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '灾情速报列表读取失败'
  }
}

// 查询条件在返回本页后保持：挂载时恢复条件并按它取数。
function reloadAndPersist() {
  persistQuery()
  reload()
}

function resetFilters() {
  Object.assign(query, emptyQuery())
  persistQuery()
  reload()
}

function exportRows() {
  // 导出走归一化后的数据，缺发生时间的旧记录也是待补录状态。
  normalizeReportRows()
  downloadEntries('report')
}

function openCreate() {
  errorMessage.value = '灾情速报登记入口尚未接入审批流'
}

const verifyModal = reactive<{
  open: boolean
  row: EntryRow | null
  verdict: string
  error: string
}>({ open: false, row: null, verdict: '', error: '' })

const existingVerdicts = computed(() => (verifyModal.row ? verdictSet(verifyModal.row) : []))

const fillModal = reactive<{ open: boolean; row: EntryRow | null; time: string; error: string }>({
  open: false,
  row: null,
  time: '',
  error: '',
})

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  if (action === '确认核实') {
    verifyModal.open = true
    verifyModal.row = row
    verifyModal.verdict = primaryVerdict(row) || ''
    verifyModal.error = ''
    return
  }
  if (action === '补充发生时间') {
    fillModal.open = true
    fillModal.row = row
    fillModal.time = occurredAt(row)
    fillModal.error = ''
    return
  }
  const result = runReportAction(Number(row.id), action, { region: session.region })
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function submitVerify() {
  if (!verifyModal.row) {
    return
  }
  const result = runReportAction(Number(verifyModal.row.id), '确认核实', {
    region: session.region,
    verdict: verifyModal.verdict,
  })
  if (!result.ok) {
    verifyModal.error = result.message
    return
  }
  closeVerify()
  reload()
}

function closeVerify() {
  verifyModal.open = false
  verifyModal.row = null
  verifyModal.verdict = ''
  verifyModal.error = ''
}

function submitFill() {
  if (!fillModal.row) {
    return
  }
  const result = runReportAction(Number(fillModal.row.id), '补充发生时间', {
    region: session.region,
    occurrenceTime: fillModal.time,
  })
  if (!result.ok) {
    fillModal.error = result.message
    return
  }
  closeFill()
  reload()
}

function closeFill() {
  fillModal.open = false
  fillModal.row = null
  fillModal.time = ''
  fillModal.error = ''
}

onMounted(reloadAndPersist)
</script>
