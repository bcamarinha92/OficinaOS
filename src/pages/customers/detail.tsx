import type { JobStatusType } from "@shared/constants";
import {
  CUSTOMER_ADDRESS_MAX,
  CUSTOMER_CITY_MAX,
  CUSTOMER_EMAIL_MAX,
  CUSTOMER_NAME_MAX,
  CUSTOMER_NOTES_MAX,
} from "@shared/schemas/customer.schema";
import { PHONE_MAX_LENGTH } from "@shared/utils/phone";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { RecordWorkflow } from "@/components/modules/tasks/record-workflow";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import { BusinessHistory } from "@/pages/business/history";
import { useCustomersStore } from "@/stores/customers";

export default function CustomerDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const {
    currentCustomer,
    fetchCustomer,
    updateCustomer,
    isLoadingCustomer,
    error,
  } = useCustomersStore();
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editCity, setEditCity] = useState("");
  const [editNotes, setEditNotes] = useState("");

  useEffect(() => {
    if (id) {
      fetchCustomer(id);
    }
  }, [id, fetchCustomer]);

  useEffect(() => {
    if (currentCustomer) {
      setEditName(currentCustomer.name);
      setEditPhone(currentCustomer.phone);
      setEditEmail(currentCustomer.email ?? "");
      setEditAddress(currentCustomer.address ?? "");
      setEditCity(currentCustomer.city ?? "");
      setEditNotes(currentCustomer.notes ?? "");
    }
  }, [currentCustomer]);

  if (isLoadingCustomer) {
    return (
      <div className="flex items-center justify-center py-24">
        <span className="material-symbols-outlined animate-spin text-4xl text-primary">
          progress_activity
        </span>
      </div>
    );
  }

  if (error && !currentCustomer) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <span className="material-symbols-outlined text-4xl text-error">
          error
        </span>
        <p className="mt-3 font-medium text-on-surface-variant">{error}</p>
        <Link
          className="mt-4 text-primary text-sm hover:underline"
          to="/customers"
        >
          {t("back_to_customers")}
        </Link>
      </div>
    );
  }

  if (!currentCustomer) {
    return null;
  }

  const handleSave = async () => {
    try {
      await updateCustomer(currentCustomer.id, {
        name: editName,
        phone: editPhone,
        email: editEmail || undefined,
        // "" clears these server-side.
        address: editAddress,
        city: editCity,
        notes: editNotes,
      });
      await fetchCustomer(currentCustomer.id);
      setEditing(false);
    } catch {
      // updateCustomer and fetchCustomer both set error state in the store
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link
          className="flex items-center gap-2 text-on-surface-variant text-sm hover:text-primary"
          to="/customers"
        >
          <span className="material-symbols-outlined text-lg">arrow_back</span>
          {t("back_to_customers")}
        </Link>
      </div>

      <div className="rounded-xl bg-surface-container-low p-6">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="font-extrabold font-headline text-2xl text-on-surface">
            {currentCustomer.name}
          </h1>
          <button
            className="flex items-center gap-1 rounded-lg bg-primary px-3 py-2 font-bold text-on-primary text-xs"
            onClick={() => setEditing(!editing)}
            type="button"
          >
            <span className="material-symbols-outlined text-sm">
              {editing ? "close" : "edit"}
            </span>
            {editing ? t("cancel") : t("edit_customer")}
          </button>
        </div>

        {editing ? (
          <div className="space-y-3">
            <Field label={t("customer_name_label")}>
              <Input
                id="edit-name"
                maxLength={CUSTOMER_NAME_MAX}
                onChange={(e) => setEditName(e.target.value)}
                value={editName}
              />
            </Field>
            <Field label={t("customer_phone")}>
              <Input
                dir="ltr"
                id="edit-phone"
                maxLength={PHONE_MAX_LENGTH}
                onChange={(e) => setEditPhone(e.target.value)}
                type="tel"
                value={editPhone}
              />
            </Field>
            <Field label={t("customer_email")}>
              <Input
                id="edit-email"
                maxLength={CUSTOMER_EMAIL_MAX}
                onChange={(e) => setEditEmail(e.target.value)}
                type="email"
                value={editEmail}
              />
            </Field>
            <Field label={t("add_customer_modal.address")}>
              <Input
                autoComplete="street-address"
                maxLength={CUSTOMER_ADDRESS_MAX}
                onChange={(e) => setEditAddress(e.target.value)}
                value={editAddress}
              />
            </Field>
            <Field label={t("add_customer_modal.city")}>
              <Input
                autoComplete="address-level2"
                maxLength={CUSTOMER_CITY_MAX}
                onChange={(e) => setEditCity(e.target.value)}
                value={editCity}
              />
            </Field>
            <Field label={t("add_customer_modal.notes")}>
              <Textarea
                maxLength={CUSTOMER_NOTES_MAX}
                onChange={(e) => setEditNotes(e.target.value)}
                placeholder={t("add_customer_modal.notes_placeholder")}
                rows={3}
                value={editNotes}
              />
            </Field>
            <button
              className="rounded-lg bg-primary px-4 py-2 font-bold text-on-primary text-sm"
              onClick={handleSave}
              type="button"
            >
              {t("save_changes")}
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-on-surface-variant">
              <span className="material-symbols-outlined me-2 align-middle text-sm">
                phone
              </span>
              {currentCustomer.phone}
            </p>
            {currentCustomer.email && (
              <p className="text-on-surface-variant">
                <span className="material-symbols-outlined me-2 align-middle text-sm">
                  email
                </span>
                {currentCustomer.email}
              </p>
            )}
            {(currentCustomer.address || currentCustomer.city) && (
              <p className="text-on-surface-variant">
                <span className="material-symbols-outlined me-2 align-middle text-sm">
                  home
                </span>
                {[currentCustomer.address, currentCustomer.city]
                  .filter(Boolean)
                  .join(", ")}
              </p>
            )}
            {currentCustomer.notes && (
              <div className="mt-3 rounded-lg bg-surface-container p-3">
                <p className="mb-1 font-medium text-on-surface-variant text-xs">
                  {t("add_customer_modal.notes")}
                </p>
                <p className="whitespace-pre-line text-on-surface text-sm">
                  {currentCustomer.notes}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-4 font-bold font-headline text-lg text-on-surface">
          {t("customer_jobs")}
        </h2>
        {currentCustomer.jobs.length === 0 ? (
          <p className="text-on-surface-variant">{t("no_jobs_for_customer")}</p>
        ) : (
          <div className="space-y-2">
            {currentCustomer.jobs.map((job) => (
              <Link
                className="flex items-center justify-between rounded-xl bg-surface-container-low p-4 transition-colors hover:bg-surface-container"
                key={job.id}
                to={`/jobs/${job.id}`}
              >
                <div>
                  <p className="font-bold text-on-surface text-sm">
                    {job.jobCode} &bull; {job.deviceModel}
                  </p>
                  <p className="text-on-surface-variant text-xs">
                    {job.reportedProblem}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-on-surface-variant text-xs">
                    {new Date(job.createdAt).toLocaleDateString()}
                  </span>
                  <StatusBadge status={job.status as JobStatusType} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      <BusinessHistory entityId={currentCustomer.id} entityType="CUSTOMER" />
      <RecordWorkflow entityId={currentCustomer.id} entityType="CUSTOMER" />
    </div>
  );
}
