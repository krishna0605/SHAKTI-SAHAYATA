import { useState } from 'react';

interface CaseFormProps {
  onSubmit: (data: CaseFormData) => Promise<void>;
  onClose: () => void;
}

export interface CaseFormData {
  caseName: string;
  operator: string;
  investigationDetails: string;
  startDate: string;
  endDate: string;
  priority: string;
  caseType: string;
  firNumber: string;
}

const OPERATORS = ['Jio', 'Airtel', 'Vi (Vodafone Idea)', 'BSNL', 'MTNL', 'Other'];
const CASE_TYPES = ['Cyber Crime', 'Financial Fraud', 'Drug Trafficking', 'Missing Person', 'Terrorism', 'Other'];

export default function CaseForm({ onSubmit, onClose }: CaseFormProps) {
  const [form, setForm] = useState<CaseFormData>({
    caseName: '', operator: '', investigationDetails: '',
    startDate: '', endDate: '', priority: 'medium', caseType: '', firNumber: ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.caseName.trim()) { setError('Case name is required'); return; }
    setLoading(true);
    setError('');
    try {
      await onSubmit(form);
    } catch (err: any) {
      setError(err.message || 'Failed to create case');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content case-form-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Create New Case</h2>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>

        <form onSubmit={handleSubmit} className="case-form">
          {error && <div className="form-error">{error}</div>}

          <div className="form-row">
            <div className="form-group">
              <label>Case Name *</label>
              <input type="text" value={form.caseName} onChange={e => setForm({...form, caseName: e.target.value})}
                placeholder="e.g. Mumbai Cyber Fraud 2026" required />
            </div>
            <div className="form-group">
              <label>FIR Number</label>
              <input type="text" value={form.firNumber} onChange={e => setForm({...form, firNumber: e.target.value})}
                placeholder="e.g. FIR/2026/0042" />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Case Type</label>
              <select value={form.caseType} onChange={e => setForm({...form, caseType: e.target.value})}>
                <option value="">Select type...</option>
                {CASE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Telecom Operator</label>
              <select value={form.operator} onChange={e => setForm({...form, operator: e.target.value})}>
                <option value="">Select operator...</option>
                {OPERATORS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Priority</label>
              <select value={form.priority} onChange={e => setForm({...form, priority: e.target.value})}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Start Date</label>
              <input type="date" value={form.startDate} onChange={e => setForm({...form, startDate: e.target.value})} />
            </div>
            <div className="form-group">
              <label>End Date</label>
              <input type="date" value={form.endDate} onChange={e => setForm({...form, endDate: e.target.value})} />
            </div>
          </div>

          <div className="form-group">
            <label>Investigation Details</label>
            <textarea value={form.investigationDetails} onChange={e => setForm({...form, investigationDetails: e.target.value})}
              placeholder="Describe the investigation context, suspects, objectives..."
              rows={4} />
          </div>

          <div className="form-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={loading}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Creating...' : 'Create Case'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
