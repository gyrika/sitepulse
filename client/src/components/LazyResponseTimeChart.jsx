import { lazy, Suspense } from 'react';
import { LoadingState } from './ui.jsx';

// Recharts is by far the largest dependency, so it downloads only when a chart appears.
const ResponseTimeChart = lazy(() =>
  import('./ResponseTimeChart.jsx').then((module) => ({ default: module.ResponseTimeChart })),
);

export function LazyResponseTimeChart(props) {
  return (
    <Suspense fallback={<LoadingState label="Loading chart" />}>
      <ResponseTimeChart {...props} />
    </Suspense>
  );
}
