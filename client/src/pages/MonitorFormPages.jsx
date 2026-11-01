import { useNavigate, useParams } from 'react-router';
import { api } from '../api/client.js';
import { MonitorForm } from '../components/MonitorForm.jsx';
import { Card, ErrorState, LoadingState, PageHeader } from '../components/ui.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useResource } from '../hooks/useResource.js';

export function NewMonitorPage() {
  const navigate = useNavigate();
  const toast = useToast();

  async function create(values) {
    const monitor = await api.createMonitor(values);
    toast.success(`Now monitoring ${monitor.name}.`);
    navigate(`/monitors/${monitor.id}`);
  }

  return (
    <>
      <PageHeader title="Add monitor" description="SitePulse will check this website every 60 seconds." />
      <Card className="max-w-xl">
        <MonitorForm
          submitLabel="Add monitor"
          urlHint="A public HTTP or HTTPS address. Private and internal addresses are not allowed."
          showStartPaused
          onSubmit={create}
          onCancel={() => navigate('/monitors')}
        />
      </Card>
    </>
  );
}

export function EditMonitorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { data, error, loading, reload } = useResource(() => api.getMonitor(id), [id]);

  async function save(values) {
    const monitor = await api.updateMonitor(id, { name: values.name, url: values.url });
    toast.success(`Saved ${monitor.name}.`);
    navigate(`/monitors/${id}`);
  }

  return (
    <>
      <PageHeader title="Edit monitor" />
      <Card className="max-w-xl">
        {loading ? <LoadingState label="Loading monitor" /> : null}
        {!loading && !data ? <ErrorState error={error} onRetry={reload} title="This monitor could not be loaded" /> : null}
        {data ? (
          <MonitorForm
            initial={data}
            submitLabel="Save changes"
            urlHint="Changing the URL resets this monitor's status and closes any open incident."
            onSubmit={save}
            onCancel={() => navigate(`/monitors/${id}`)}
          />
        ) : null}
      </Card>
    </>
  );
}
