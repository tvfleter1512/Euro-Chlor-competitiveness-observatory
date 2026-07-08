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

export default function EChart({ option, height = 300, theme }) {
  const ref = useRef(null)
  const chart = useRef(null)

  useEffect(() => {
    chart.current = echarts.init(ref.current, null, { renderer: 'canvas' })
    const onResize = () => chart.current?.resize()
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('resize', onResize); chart.current?.dispose() }
  }, [])

  useEffect(() => {
    if (chart.current && option) chart.current.setOption(option, { notMerge: true })
  }, [option, theme])

  return <div ref={ref} style={{ width: '100%', height }} />
}
