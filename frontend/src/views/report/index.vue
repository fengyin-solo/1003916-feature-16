<template>
  <section class="page" data-module="report">
    <header class="page-head">
      <div>
        <h2>灾情速报管理</h2>
        <p class="page-desc">
          按发生时间段、灾害类型、受灾范围与核实结论组合检索，可定位待核实、已上报、已归档与待补录记录；跨区域速报仅可查看。
        </p>
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

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
      <span class="legend-item">待补录：{{ missingTimeCount }}</span>
    </p>

    <form class="filter-bar" @submit.prevent="applyFilters">
      <label class="filter-item">
        <span>发生时间起</span>
        <input v-model="filters['发生时间::from']" type="date" />
      </label>
      <label class="filter-item">
        <span>发生时间止</span>
        <input v-model="filters['发生时间::to']" type="date" />
      </label>
      <label class="filter-item">
        <span>灾害类型</span>
        <input v-model="filters['灾害类型']" placeholder="按灾害类型检索" />
      </label>
      <label class="filter-item">
        <span>受灾范围</span>
        <input v-model="filters['受灾范围']" placeholder="按受灾范围检索" />
      </label>
      <label class="filter-item">
        <span>核实结论</span>
        <select v-model="filters['核实结论']">
          <option value="">全部</option>
          <option v-for="item in conclusions" :key="item" :value="item">{{ item }}</option>
        </select>
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <p class="locate-bar">
      <span class="locate-label">结果定位：</span>
      <button
        v-for="item in locateOptions"
        :key="item.key"
        class="chip"
        :class="{ active: locate === item.key }"
        type="button"
        @click="applyLocate(item.key)"
      >
        {{ item.label }}
      </button>
    </p>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)" :class="{ 'row-readonly': isCrossRegion(row) }">
          <td v-for="column in columns" :key="column">
            <template v-if="column === '发生时间'">
              <span v-if="missingTime(row)" class="tag danger">待补录</span>
              <template v-else>{{ row[column] }}</template>
            </template>
            <template v-else-if="column === '核实结论'">
              <template v-if="primaryConclusion(row)">
                {{ primaryConclusion(row) }}
                <span v-if="conclusionCount(row) > 1" class="tag">共{{ conclusionCount(row) }}条</span>
              </template>
              <template v-else>—</template>
            </template>
            <template v-else>{{ row[column] ?? '—' }}</template>
          </td>
          <td><span class="status-pill" :data-status="row.status">{{ row.status }}</span></td>
          <td class="row-actions">
            <span v-if="isCrossRegion(row)" class="muted-text">跨区域仅可查看</span>
            <template v-else>
              <button
                v-for="action in actions"
                :key="action"
                class="link"
                type="button"
                @click="runAction(action, row)"
              >
                {{ action }}
              </button>
            </template>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">没有符合条件的灾情速报，可调整查询条件</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条灾情速报记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const meta = moduleMeta('report')
const store = useSessionStore()

const columns = ["速报编号", "隐患点编号", "发生时间", "灾害类型", "受灾范围", "所属区域", "核实结论", "伤亡人数", "经济损失", "速报状态"]
const actions = ["提交核实", "确认核实", "上报灾情"]
const statuses = ["已录入", "待核实", "已核实", "已上报", "已归档"]
const conclusions = ["属实", "部分属实", "不属实"]
// 同一速报命中多个核实结论时，按风险优先展示：不属实 > 部分属实 > 属实
const CONCLUSION_PRIORITY = ["不属实", "部分属实", "属实"]
const verifiedStatuses = ["已核实", "已上报", "已归档"]

const locateOptions = [
  { key: 'all', label: '全部' },
  { key: '待核实', label: '待核实' },
  { key: '已上报', label: '已上报' },
  { key: '已归档', label: '已归档' },
  { key: 'missing', label: '待补录' },
]

// 查询条件落在 sessionStorage：离开页面再返回时原样恢复
const QUERY_STORAGE_KEY = 'report:query'

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>(defaultFilters())
const locate = ref('all')

function defaultFilters(): Record<string, string> {
  return { '发生时间::from': '', '发生时间::to': '', '灾害类型': '', '受灾范围': '', '核实结论': '' }
}

const stats = computed(() => {
  const month = new Date().toISOString().slice(0, 7)
  return [
    { label: '本月速报数', value: rows.value.filter((row) => String(row['发生时间'] ?? '').startsWith(month)).length },
    { label: '已核实数', value: rows.value.filter((row) => verifiedStatuses.includes(String(row.status))).length },
    { label: '待上报数', value: rows.value.filter((row) => row.status === '已核实').length },
  ]
})

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const missingTimeCount = computed(() => rows.value.filter(missingTime).length)

function missingTime(row: EntryRow): boolean {
  return String(row['发生时间'] ?? '').trim() === ''
}

function isCrossRegion(row: EntryRow): boolean {
  const region = String(row['所属区域'] ?? '')
  return region !== '' && region !== store.region
}

function conclusionList(row: EntryRow): string[] {
  const cell = row['核实结论']
  return Array.isArray(cell) ? cell.map(String) : []
}

function conclusionCount(row: EntryRow): number {
  return conclusionList(row).length
}

function primaryConclusion(row: EntryRow): string {
  const list = conclusionList(row)
  for (const item of CONCLUSION_PRIORITY) {
    if (list.includes(item)) {
      return item
    }
  }
  return list[0] ?? ''
}

function currentQuery(): Record<string, string> {
  const query: Record<string, string> = {}
  for (const [field, value] of Object.entries(filters.value)) {
    if (value.trim() !== '') {
      query[field] = value.trim()
    }
  }
  if (locate.value === 'missing') {
    // 缺发生时间的旧记录进入待补录
    query['发生时间::missing'] = '1'
  } else if (locate.value !== 'all') {
    query['status'] = locate.value
  }
  return query
}

function persistQuery() {
  sessionStorage.setItem(QUERY_STORAGE_KEY, JSON.stringify({ filters: filters.value, locate: locate.value }))
}

function restoreQuery() {
  try {
    const raw = sessionStorage.getItem(QUERY_STORAGE_KEY)
    if (!raw) {
      return
    }
    const saved = JSON.parse(raw) as { filters?: Record<string, string>; locate?: string }
    filters.value = { ...defaultFilters(), ...saved.filters }
    locate.value = saved.locate ?? 'all'
  } catch {
    sessionStorage.removeItem(QUERY_STORAGE_KEY)
  }
}

function applyFilters() {
  persistQuery()
  reload()
}

function applyLocate(key: string) {
  locate.value = key
  persistQuery()
  reload()
}

function resetFilters() {
  filters.value = defaultFilters()
  locate.value = 'all'
  persistQuery()
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '灾情速报登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  let conclusion: string | undefined
  if (action === '确认核实') {
    const input = window.prompt(`请填写核实结论（${conclusions.join(' / ')}）`, '属实')
    if (input === null) {
      return
    }
    conclusion = input.trim() || '属实'
    if (!conclusions.includes(conclusion)) {
      errorMessage.value = `核实结论只能是：${conclusions.join(' / ')}`
      return
    }
  }
  const result = applyAction(meta.key, Number(row.id), action, { region: store.region, conclusion })
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, currentQuery())
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '灾情速报列表读取失败'
  }
}

onMounted(() => {
  restoreQuery()
  reload()
})
</script>
