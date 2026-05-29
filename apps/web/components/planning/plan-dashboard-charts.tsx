"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export function PlanVsActualChart({
  data,
}: {
  data: Array<{ code: string; name: string; plan: number; actual: number }>;
}) {
  const chartData = data.map((row) => ({
    name: row.code,
    plan: row.plan,
    actual: row.actual,
  }));

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={chartData} layout="vertical" margin={{ left: 48 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis type="number" />
        <YAxis type="category" dataKey="name" width={72} />
        <Tooltip />
        <Legend />
        <Bar dataKey="plan" fill="#94a3b8" name="Plan" />
        <Bar dataKey="actual" fill="#22c55e" name="Aktual" />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function MonthlyTimelineChart({
  data,
}: {
  data: Array<{ month: number; plan: number; actual: number }>;
}) {
  const chartData = data.map((row) => ({
    month: `M${row.month}`,
    plan: row.plan,
    actual: row.actual,
  }));

  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="month" />
        <YAxis />
        <Tooltip />
        <Legend />
        <Line type="monotone" dataKey="plan" stroke="#94a3b8" name="Plan" />
        <Line type="monotone" dataKey="actual" stroke="#22c55e" name="Aktual" />
      </LineChart>
    </ResponsiveContainer>
  );
}
