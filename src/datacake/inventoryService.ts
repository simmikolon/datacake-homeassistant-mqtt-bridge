import { childLogger } from "../utils/logger";
import { configService } from "../config/configService";
import { getDb } from "../db/database";
import {
  deleteDevicesNotIn,
  upsertDevice
} from "../db/repositories/devicesRepo";
import {
  deleteFieldsNotIn,
  getField,
  updateMappedColumns,
  upsertFieldDefinition
} from "../db/repositories/fieldsRepo";
import { defaultExportFor } from "../mapping/exportPolicy";
import { mapField } from "../mapping/fieldMapper";
import { fetchDevicesPage } from "./datacakeApi";
import type { DatacakeDevice } from "./types";

const log = childLogger("inventory");

const DEFAULT_PAGE_SIZE = 50;
// Hard safety cap so a broken API response (e.g. total ever-growing) cannot
// turn the sync into an infinite loop.
const MAX_PAGES = 500;

export type InventorySyncResult = {
  total: number;
  loadedDevices: number;
  newFields: number;
  removedDevices: number;
};

export async function syncInventory(
  pageSize = DEFAULT_PAGE_SIZE
): Promise<InventorySyncResult> {
  const settings = configService.get();
  if (!settings.datacake.token || !settings.datacake.workspaceId) {
    throw new Error("Datacake API credentials are not configured");
  }

  const opts = {
    endpoint: settings.datacake.endpoint,
    token: settings.datacake.token,
    workspaceId: settings.datacake.workspaceId
  };

  // Collection strategy (per review):
  //   - iterate pages starting at page=0
  //   - dedupe devices by `device.id` using a Map
  //   - stop when either
  //       (a) the API returns an empty page, or
  //       (b) the number of UNIQUE collected devices is >= `total`.
  //   - never rely on `devices.length * (page + 1) >= total` because it
  //     breaks when the API returns duplicates or uneven page sizes.
  const seen = new Map<string, DatacakeDevice>();
  let page = 0;
  let total = 0;
  let safety = 0;

  while (safety < MAX_PAGES) {
    safety += 1;
    const result = await fetchDevicesPage(opts, page, pageSize);
    total = result.total;
    if (!result.devices.length) {
      log.debug({ page, total }, "Empty device page received, stopping pagination");
      break;
    }
    for (const dev of result.devices) {
      if (dev && dev.id) seen.set(dev.id, dev);
    }
    if (seen.size >= total) {
      log.debug({ page, total, unique: seen.size }, "Collected all devices");
      break;
    }
    page += 1;
  }

  if (safety >= MAX_PAGES) {
    log.warn({ MAX_PAGES }, "Pagination hit the safety cap; partial result");
  }

  const devices = Array.from(seen.values());
  log.info({ total, loaded: devices.length }, "Inventory loaded from Datacake");

  let newFields = 0;
  let removed = 0;

  const db = getDb();
  const tx = db.transaction(() => {
    for (const dev of devices) {
      try {
        upsertDevice({
          id: dev.id,
          verboseName: dev.verboseName ?? dev.id,
          productSlug: dev.product?.slug ?? "",
          online: Boolean(dev.online),
          lastHeard: dev.lastHeard ?? null,
          raw: dev
        });

        // LOCATION / GEO / USER_LOG fields still go into the DB via
        // `upsertFieldDefinition`. We only flag them ignored in the mapping
        // columns so future releases can surface them as device attributes
        // (see fieldMapper.ts for the rationale).
        const activeFields = dev.product?.measurementFields ?? [];
        for (const field of activeFields) {
          if (!field?.fieldName) continue;
          const existing = getField(dev.id, field.fieldName);
          const mapped = mapField({
            fieldName: field.fieldName,
            fieldType: String(field.fieldType ?? ""),
            semantic: field.semantic ?? null
          });

          if (!existing) {
            const defaults = defaultExportFor({
              fieldName: field.fieldName,
              fieldType: String(field.fieldType ?? ""),
              semantic: field.semantic ?? null
            });
            upsertFieldDefinition({
              deviceId: dev.id,
              fieldName: field.fieldName,
              fieldType: String(field.fieldType ?? ""),
              semantic: field.semantic ?? null,
              defaultEnabled: defaults.enabled,
              defaultDiagnostic: defaults.diagnostic
            });
            newFields += 1;
          } else {
            upsertFieldDefinition({
              deviceId: dev.id,
              fieldName: field.fieldName,
              fieldType: String(field.fieldType ?? ""),
              semantic: field.semantic ?? null,
              defaultEnabled: existing.enabled,
              defaultDiagnostic: existing.diagnostic
            });
          }

          // Snapshot the mapping decision into the fields table. Persisting
          // these keeps the UI snappy and allows inspection of historical
          // mapping outcomes after `semanticRules.ts` evolves.
          updateMappedColumns(dev.id, field.fieldName, {
            component: mapped.ignore ? null : mapped.component,
            deviceClass: mapped.rule.device_class ?? null,
            unit: mapped.rule.unit_of_measurement ?? null,
            stateClass: mapped.rule.state_class ?? null,
            ignored: mapped.ignore
          });
        }
        const activeNames = activeFields
          .map((f) => f?.fieldName)
          .filter((n): n is string => Boolean(n));
        deleteFieldsNotIn(dev.id, activeNames);
      } catch (err) {
        // Single device failures must never abort the whole inventory pass.
        log.warn({ err, deviceId: dev.id }, "Failed to persist device inventory entry");
      }
    }

    removed = deleteDevicesNotIn(devices.map((d) => d.id));
  });
  tx();

  return {
    total,
    loadedDevices: devices.length,
    newFields,
    removedDevices: removed
  };
}
