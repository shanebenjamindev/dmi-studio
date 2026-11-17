import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';
import { openLink, toast } from '../store';
import type { Brand, BrandServiceItem, Loc, ServiceRef, TaskMeta } from '../types';
import { askConfirm } from './AskDialog';
import { fileToAvatarDataUrl } from './boardkit';
import { BrandLoading } from './BrandLoading';
import { FolderPicker } from './FolderPicker';
import { ProjectEditDialog } from './ProjectEditDialog';
import { TaskEditor } from './Tasks';
import { Icon } from './ui';
import { BrandServiceStageBadge, Button, EmptyState } from './kit';

type ProjectRow = TaskMeta['projects'][number];

const BRAND_COLORS = ['#0b66e4', '#16a34a', '#d97706', '#7c3aed', '#db2777', '#0891b2', '#dc2626', '#4f46e5'];
function brandColor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return BRAND_COLORS[Math.abs(h) % BRAND_COLORS.length];
}

export function BrandAvatar({
  name,
  logo,
  size = 40,
}: {
  name: string;
  logo?: string | null;
  size?: number;
}) {
  const initial = (name.trim()[0] || 'B').toUpperCase();
  return (
    <span
      className="cbt-brand-avatar"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.44),
        background: logo ? 'var(--surface-2)' : brandColor(name || 'brand'),
      }}
      aria-hidden="true"
    >
      {logo ? <img src={logo} alt="" /> : initial}
    </span>
  );
}

export function BrandDialog({
  customerId,
  brand,
  onClose,
  onSaved,
}: {
  customerId: string;
  brand?: Brand | null;
  onClose: () => void;
  onSaved: (b: Brand) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(brand?.name || '');
  const [notes, setNotes] = useState(brand?.notes || '');
  const [logo, setLogo] = useState<string | null>(brand?.logo || null);
  const [driveFolder, setDriveFolder] = useState<Loc | null>(
    brand?.driveFolder?.id
      ? { kind: 'gdrive', account: brand.driveFolder.account, id: brand.driveFolder.id, label: brand.driveFolder.label || brand.driveFolder.id }
      : null,
  );
  const [driveLink, setDriveLink] = useState('');
  const [pickingDrive, setPickingDrive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!dialog.current?.open) dialog.current?.showModal();
  }, []);

  const pickLogoFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const dataUrl = await fileToAvatarDataUrl(f);
      setLogo(dataUrl);
    } catch (err: any) {
      toast(err.message || 'Không đọc được ảnh đại diện', true);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true);
    setError('');
    try {
      const payload = {
        name: name.trim(),
        notes: notes.trim(),
        logo,
        ...(driveLink.trim()
          ? { driveLink: driveLink.trim() }
          : { driveFolder: driveFolder && driveFolder.kind === 'gdrive' ? driveFolder : null }),
      };
      const saved = brand
        ? await api.updateBrand(brand.id, payload)
        : await api.createBrand(customerId, payload);
      toast(brand ? `Đã cập nhật nhãn hàng “${saved.name}”` : `Đã thêm nhãn hàng “${saved.name}”`);
      onSaved(saved);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <>
      <dialog
        ref={dialog}
        className="qc-dialog"
        aria-label={brand ? 'Chỉnh sửa nhãn hàng' : 'Thêm nhãn hàng'}
        onCancel={(e) => {
          e.preventDefault();
          if (!busy && !pickingDrive) onClose();
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget && !busy && !pickingDrive) onClose();
        }}
      >
        <form onSubmit={submit}>
          <header>
            <h2>{brand ? 'Chỉnh sửa nhãn hàng' : 'Thêm nhãn hàng'}</h2>
            <button type="button" className="bd-icon" disabled={busy} onClick={onClose} aria-label="Đóng">
              <Icon name="x" size={16} />
            </button>
          </header>
          <fieldset disabled={busy}>
            <div className="qc-field">
              <span>Ảnh đại diện nhãn hàng</span>
              <div className="cbt-avatar-picker">
                <button
                  type="button"
                  className="cbt-avatar-btn"
                  onClick={() => fileRef.current?.click()}
                  title="Chọn ảnh đại diện nhãn hàng"
                >
                  <BrandAvatar name={name || 'Nhãn hàng'} logo={logo} size={56} />
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    void pickLogoFile(f);
                  }}
                />
                <div className="cbt-avatar-actions">
                  <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
                    {logo ? 'Đổi ảnh đại diện' : 'Chọn ảnh đại diện'}
                  </Button>
                  {logo && (
                    <Button variant="ghost" size="sm" onClick={() => setLogo(null)}>
                      Xoá ảnh
                    </Button>
                  )}
                  <small>Ảnh PNG, JPG, WebP hoặc GIF. Dùng chung làm biểu tượng Workspace của nhãn hàng.</small>
                </div>
              </div>
            </div>
            <label>
              Tên nhãn hàng
              <input
                className="bk-in"
                autoFocus
                required
                maxLength={200}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ví dụ: DM Ceramic Pro"
              />
            </label>
            <div className="qc-field">
              <span>Thư mục Google Drive của nhãn hàng</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                <Button variant="secondary" size="sm" icon="folder" onClick={() => setPickingDrive(true)}>
                  {driveFolder ? 'Đổi thư mục Drive' : 'Chọn từ Drive của bạn'}
                </Button>
                {driveFolder && (
                  <>
                    <span className="note" style={{ margin: 0 }}>{driveFolder.kind === 'gdrive' ? driveFolder.label || driveFolder.id : driveFolder.dir}</span>
                    <Button variant="ghost" size="sm" onClick={() => setDriveFolder(null)}>Gỡ</Button>
                  </>
                )}
              </div>
              <input
                className="bk-in"
                value={driveLink}
                onChange={(e) => setDriveLink(e.target.value)}
                placeholder="Hoặc dán link thư mục Google Drive của nhãn hàng…"
                style={{ marginTop: 6 }}
              />
              <small>Khách hàng sẽ tự động tổng hợp các link Drive từ các nhãn hàng này.</small>
            </div>
            <label>
              Ghi chú
              <textarea
                className="bk-in"
                rows={3}
                maxLength={5000}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Mô tả ngắn, lưu ý hoặc mục tiêu của nhãn hàng…"
              />
            </label>
          </fieldset>
          {error && <p className="note err" role="alert">{error}</p>}
          <footer>
            <Button variant="secondary" disabled={busy} onClick={onClose}>Đóng</Button>
            <Button type="submit" variant="primary" disabled={busy || !name.trim()}>
              {busy ? 'Đang lưu…' : brand ? 'Lưu nhãn hàng' : 'Thêm nhãn hàng'}
            </Button>
          </footer>
        </form>
      </dialog>
      <FolderPicker
        open={pickingDrive}
        title="Chọn thư mục Drive cho nhãn hàng"
        confirmLabel="Chọn thư mục này"
        onClose={() => setPickingDrive(false)}
        onPick={(loc) => {
          setDriveFolder(loc);
          setDriveLink('');
          setPickingDrive(false);
        }}
      />
    </>,
    document.body,
  );
}

export function CustomerBrandsTab({
  customerId,
  catalog,
  manage,
  activeBrandId,
  createOpen,
  onCreateHandled,
  onSelectBrand,
  onChanged,
}: {
  customerId: string;
  catalog: ServiceRef[];
  manage: boolean;
  activeBrandId?: string | null;
  createOpen?: boolean;
  onCreateHandled?: () => void;
  onSelectBrand?: (brandId: string | null) => void;
  onChanged: () => void;
}) {
  const [brands, setBrands] = useState<Brand[] | null>(null);
  const [services, setServices] = useState<BrandServiceItem[]>([]);
  const [meta, setMeta] = useState<TaskMeta | null>(null);
  const [addingForBrand, setAddingForBrand] = useState<Record<string, string>>({});
  const [editingBrand, setEditingBrand] = useState<Brand | null>(null);
  const [creatingBrand, setCreatingBrand] = useState(false);
  const [editingService, setEditingService] = useState<ProjectRow | null>(null);
  const [creatingTaskBrand, setCreatingTaskBrand] = useState<Brand | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const quickLogoInputRef = useRef<HTMLInputElement>(null);
  const [logoTargetBrand, setLogoTargetBrand] = useState<Brand | null>(null);

  const loadAll = async () => {
    try {
      const [br, bs, m] = await Promise.all([
        api.customerBrands(customerId),
        api.brandServices({ customerId }),
        api.taskMeta(),
      ]);
      setBrands(br);
      setServices(bs);
      setMeta(m);
      setError('');
    } catch (err: any) {
      setError(err.message);
      setBrands([]);
    }
  };

  useEffect(() => {
    setBrands(null);
    void loadAll();
  }, [customerId]);

  useEffect(() => {
    if (createOpen) {
      setCreatingBrand(true);
      onCreateHandled?.();
    }
  }, [createOpen]);

  const handleQuickLogoChange = async (file: File | undefined) => {
    const target = logoTargetBrand;
    setLogoTargetBrand(null);
    if (!file || !target) return;
    setBusyId(target.id);
    try {
      const dataUrl = await fileToAvatarDataUrl(file);
      await api.updateBrand(target.id, { logo: dataUrl });
      toast(`Đã cập nhật ảnh đại diện nhãn hàng “${target.name}”`);
      await loadAll();
      onChanged();
      window.dispatchEvent(new Event('dms:entities-changed'));
    } catch (err: any) {
      toast(err.message || 'Không lưu được ảnh đại diện', true);
    } finally {
      setBusyId(null);
    }
  };

  const addServiceToBrand = async (brandId: string) => {
    const catId = addingForBrand[brandId];
    if (!catId || busyId) return;
    setBusyId(brandId);
    try {
      await api.createBrandService({ brandId, catalogServiceId: catId });
      setAddingForBrand((prev) => ({ ...prev, [brandId]: '' }));
      toast('Đã thêm dịch vụ cho nhãn hàng');
      await loadAll();
      onChanged();
      window.dispatchEvent(new Event('dms:entities-changed'));
    } catch (err: any) {
      toast(err.message, true);
    } finally {
      setBusyId(null);
    }
  };

  const removeBrand = async (brand: Brand) => {
    const others = (brands || []).filter((b) => b.id !== brand.id);
    const hasServices = services.some((s) => s.brandId === brand.id);
    if (hasServices && !others.length) {
      toast('Hãy xoá hoặc chuyển các dịch vụ sang nhãn hàng khác trước khi xoá nhãn hàng cuối cùng.', true);
      return;
    }
    const moveTo = hasServices ? others[0]?.id : undefined;
    const msg = hasServices && others[0]
      ? `Xoá nhãn hàng “${brand.name}” và chuyển các dịch vụ sang “${others[0].name}”?`
      : `Xoá nhãn hàng “${brand.name}”?`;
    if (!(await askConfirm(msg))) return;
    setBusyId(brand.id);
    try {
      await api.deleteBrand(brand.id, moveTo);
      toast(`Đã xoá nhãn hàng “${brand.name}”`);
      if (activeBrandId === brand.id) onSelectBrand?.(null);
      await loadAll();
      onChanged();
      window.dispatchEvent(new Event('dms:entities-changed'));
    } catch (err: any) {
      toast(err.message, true);
    } finally {
      setBusyId(null);
    }
  };

  const removeService = async (bs: BrandServiceItem) => {
    if (!(await askConfirm(`Xoá dịch vụ “${bs.name}”? Công việc bên trong vẫn được giữ nhưng không còn thuộc dịch vụ này.`))) return;
    setBusyId(bs.id);
    try {
      await api.deleteBrandService(bs.id);
      toast(`Đã xoá dịch vụ “${bs.name}”`);
      await loadAll();
      onChanged();
      window.dispatchEvent(new Event('dms:entities-changed'));
    } catch (err: any) {
      toast(err.message, true);
    } finally {
      setBusyId(null);
    }
  };

  if (error) return <p className="note err" role="alert">{error}</p>;
  if (brands === null) return <BrandLoading label="Đang tải nhãn hàng và dịch vụ…" />;

  const shownBrands = activeBrandId ? brands.filter((b) => b.id === activeBrandId) : brands;

  return (
    <div className="cbt-wrap">
      <input
        ref={quickLogoInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          void handleQuickLogoChange(f);
        }}
      />

      {activeBrandId && (
        <div className="cbt-filter-banner">
          <span>Đang xem nhãn hàng: <b>{shownBrands[0]?.name || activeBrandId}</b></span>
          <Button variant="ghost" size="sm" onClick={() => onSelectBrand?.(null)}>Xem tất cả nhãn hàng ({brands.length})</Button>
        </div>
      )}

      {!shownBrands.length ? (
        <EmptyState
          icon="layers"
          title="Chưa có nhãn hàng nào"
          description="Mỗi khách hàng có thể quản lý nhiều nhãn hàng và các dịch vụ triển khai riêng cho từng nhãn hàng."
          action={manage ? <Button variant="secondary" icon="plus" onClick={() => setCreatingBrand(true)}>Thêm nhãn hàng đầu tiên</Button> : undefined}
        />
      ) : (
        <div className="cbt-list">
          {shownBrands.map((brand) => {
            const brandSvcs = services.filter((s) => s.brandId === brand.id);
            const usedCatalogIds = new Set(brandSvcs.map((s) => s.catalogServiceId).filter(Boolean));
            const availableCatalog = catalog.filter((c) => !usedCatalogIds.has(c.id));
            const totalTasks = brandSvcs.reduce((sum, s) => sum + (s.tasks || 0), 0);
            const doneTasks = brandSvcs.reduce((sum, s) => sum + (s.completed || 0), 0);
            return (
              <section key={brand.id} className="cbt-card">
                <header className="cbt-card-head">
                  <div className="cbt-card-brand">
                    <button
                      type="button"
                      className="cbt-avatar-trigger"
                      disabled={!manage || busyId === brand.id}
                      onClick={() => {
                        setLogoTargetBrand(brand);
                        quickLogoInputRef.current?.click();
                      }}
                      title={manage ? 'Bấm để đổi ảnh đại diện nhãn hàng' : brand.name}
                      aria-label={`Ảnh đại diện nhãn hàng ${brand.name}`}
                    >
                      <BrandAvatar name={brand.name} logo={brand.logo} size={42} />
                    </button>
                    <div className="cbt-card-title">
                      <h3>
                        <button type="button" className="cbt-brand-link" onClick={() => onSelectBrand?.(activeBrandId === brand.id ? null : brand.id)}>
                          {brand.name}
                        </button>
                      </h3>
                      <span className="cbt-card-meta">
                        {brandSvcs.length} dịch vụ · {doneTasks}/{totalTasks} công việc
                        {brand.effectiveDriveFolder?.id && (
                          <>
                            {' · '}
                            <a
                              href={`https://drive.google.com/drive/folders/${brand.effectiveDriveFolder.id}`}
                              target="_blank"
                              rel="noreferrer"
                              className="cbt-drive-link"
                              onClick={(e) => e.stopPropagation()}
                            >
                              Drive: {brand.effectiveDriveFolder.label || brand.effectiveDriveFolder.id} ↗
                            </a>
                          </>
                        )}
                      </span>
                    </div>
                  </div>
                  <div className="cbt-card-acts">
                    <Button variant="secondary" size="sm" icon="plus" onClick={() => setCreatingTaskBrand(brand)}>
                      Tạo công việc
                    </Button>
                    {manage && (
                      <>
                        <Button variant="ghost" size="sm" icon="edit" onClick={() => setEditingBrand(brand)}>Sửa</Button>
                        <Button variant="ghost" size="sm" icon="trash" disabled={busyId === brand.id} onClick={() => void removeBrand(brand)}>Xoá</Button>
                      </>
                    )}
                  </div>
                </header>

                {brand.notes && <p className="cbt-notes">{brand.notes}</p>}

                {!brandSvcs.length ? (
                  <p className="cbt-empty-svc">Nhãn hàng chưa gắn dịch vụ riêng (có thể tạo công việc trực tiếp cho nhãn hàng hoặc thêm dịch vụ bên dưới).</p>
                ) : (
                  <ul className="cbt-svc-list">
                    {brandSvcs.map((bs) => (
                      <li key={bs.id} className="cbt-svc-row">
                        <button type="button" className="cbt-svc-main" onClick={() => openLink(`#projects/${bs.id}`)}>
                          <span className="cbt-svc-name">{bs.name}</span>
                          <BrandServiceStageBadge stage={bs.stage} />
                          <span className="cbt-svc-stat">{bs.completed || 0}/{bs.tasks} công việc</span>
                        </button>
                        {manage && (
                          <div className="cbt-svc-acts">
                            <Button
                              variant="ghost"
                              size="sm"
                              icon="edit"
                              aria-label={`Sửa dịch vụ ${bs.name}`}
                              onClick={() => {
                                const row = meta?.projects.find((p) => p.id === bs.id) || (bs as unknown as ProjectRow);
                                setEditingService(row);
                              }}
                            />
                            <Button
                              variant="ghost"
                              size="sm"
                              icon="trash"
                              aria-label={`Xoá dịch vụ ${bs.name}`}
                              disabled={busyId === bs.id}
                              onClick={() => void removeService(bs)}
                            />
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                {manage && (
                  <form
                    className="cbt-add-svc"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void addServiceToBrand(brand.id);
                    }}
                  >
                    <select
                      className="bsv-select"
                      aria-label={`Chọn dịch vụ thêm vào ${brand.name}`}
                      value={addingForBrand[brand.id] || ''}
                      onChange={(e) => setAddingForBrand((prev) => ({ ...prev, [brand.id]: e.target.value }))}
                    >
                      <option value="">{availableCatalog.length ? 'Thêm dịch vụ từ danh mục…' : 'Đã gắn đủ dịch vụ trong danh mục'}</option>
                      {availableCatalog.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                    <Button
                      type="submit"
                      variant="secondary"
                      size="sm"
                      icon="plus"
                      disabled={busyId === brand.id || !addingForBrand[brand.id]}
                    >
                      Thêm dịch vụ
                    </Button>
                  </form>
                )}
              </section>
            );
          })}
        </div>
      )}

      {(creatingBrand || editingBrand) && (
        <BrandDialog
          customerId={customerId}
          brand={editingBrand}
          onClose={() => {
            setCreatingBrand(false);
            setEditingBrand(null);
          }}
          onSaved={() => {
            setCreatingBrand(false);
            setEditingBrand(null);
            void loadAll();
            onChanged();
            window.dispatchEvent(new Event('dms:entities-changed'));
          }}
        />
      )}
      {editingService && (
        <ProjectEditDialog
          project={editingService}
          onClose={() => setEditingService(null)}
          onSaved={() => {
            setEditingService(null);
            void loadAll();
            onChanged();
            window.dispatchEvent(new Event('dms:entities-changed'));
          }}
        />
      )}
      {creatingTaskBrand && (
        <TaskEditor
          meta={meta || undefined}
          customerId={customerId}
          brandId={creatingTaskBrand.id}
          onClose={() => setCreatingTaskBrand(null)}
          onSaved={() => {
            setCreatingTaskBrand(null);
            void loadAll();
            onChanged();
          }}
        />
      )}
    </div>
  );
}
