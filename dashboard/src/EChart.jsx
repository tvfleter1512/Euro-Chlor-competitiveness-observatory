// Thin React wrapper around Apache ECharts with theme-aware defaults
// (hairline solid grid, 2px lines, crosshair tooltip — dataviz mark specs).
import React, { useEffect, useRef } from 'react'
import * as echarts from 'echarts'
import { FONT } from './theme'

export function baseOption(theme) {
  return {
    textStyle: { fontFamily: FONT },
    grid: { left: 48, right: 20, top: 16, bottom: 28, containLabel: false },
    tooltip: {
      trigger: 'axis',
      backgroundColor: theme.surface,
      borderColor: theme.border,
      borderWidth: 1,
      padding: [8, 12],
      textStyle: { color: theme.ink, fontSize: 12, fontFamily: FONT },
      extraCssText: 'box-shadow: 0 4px 16px rgba(0,0,0,0.12); border-radius: 8px;',
      axisPointer: { type: 'line', lineStyle: { color: theme.axis, width: 1 } },
    },
    xAxis: {
      type: 'category',
      axisLine: { lineStyle: { color: theme.axis, width: 1 } },
      axisTick: { show: false },
      axisLabel: { color: theme.inkMuted, fontSize: 11, hideOverlap: true },
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: theme.grid, width: 1, type: 'solid' } },
      axisLabel: { color: theme.inkMuted, fontSize: 11 },
    },
    animationDuration: 300,
  }
}

export function lineSeries(name, data, color, theme) {
  return {
    name, type: 'line', data, connectNulls: true,
    lineStyle: { width: 2, color },
    itemStyle: { color, borderColor: theme.surface, borderWidth: 2 },
    symbol: 'circle', symbolSize: 8, showSymbol: false,
    emphasis: { scale: 1.2 },
  }
}

// '2026-S1' -> 'H1 2026' for half-yearly axes and tooltips
export const fmtPeriod = p => /^\d{4}-S[12]$/.test(p) ? `H${p.slice(-1)} ${p.slice(0, 4)}` : p

// monthly category axis: one label per year (January), shown as the year
export const yearTicks = (base) => ({
  ...base.xAxis,
  axisLabel: { ...base.xAxis.axisLabel, hideOverlap: false,
               interval: (i, v) => String(v).endsWith('-01'), formatter: v => String(v).slice(0, 4) },
})

// Multi-line comparison: the focus entity drawn bold, the others thinner; each line
// carries its name at its right end; hovering a line fades the rest
export function directLabel(series, theme, bold = false) {
  return {
    ...series,
    lineStyle: { ...series.lineStyle, width: bold ? 3 : 1.6 },
    endLabel: { show: true, formatter: '{a}', color: theme.inkSecondary, fontSize: 10.5, distance: 6,
                fontWeight: bold ? 700 : 400 },
    labelLayout: { moveOverlap: 'shiftY' },
    emphasis: { focus: 'series' },
  }
}

// onClick: optional handler for clicks on a data item (e.g. a bar opens its product)
export default function EChart({ option, height = 300, theme, onClick }) {
  const ref = useRef(null)
  const chart = useRef(null)
  const click = useRef(onClick)
  click.current = onClick

  useEffect(() => {
    chart.current = echarts.init(ref.current, null, { renderer: 'canvas' })
    chart.current.on('click', p => click.current?.(p))
    const onResize = () => chart.current?.resize()
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('resize', onResize); chart.current?.dispose() }
  }, [])

  useEffect(() => {
    if (chart.current && option) chart.current.setOption(option, { notMerge: true })
  }, [option, theme])

  useEffect(() => { chart.current?.resize() }, [height])   // e.g. a ranked list grows by a row

  return <div ref={ref} style={{ width: '100%', height }} />
}
