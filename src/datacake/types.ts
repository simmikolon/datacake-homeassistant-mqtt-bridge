export type FieldType = "NUMERIC" | "BOOL" | "STRING" | "GEO";

export type MeasurementField = {
  fieldName: string;
  fieldType: FieldType | string;
  semantic: string | null;
};

export type DatacakeDevice = {
  id: string;
  verboseName: string;
  online: boolean;
  lastHeard: string | null;
  product: {
    slug: string;
    measurementFields: MeasurementField[];
  };
};

export type DevicesFilteredResult = {
  total: number;
  devices: DatacakeDevice[];
};

export type AllDevicesResponse = {
  data?: {
    workspace?: {
      devicesFiltered?: DevicesFilteredResult | null;
    } | null;
  } | null;
  errors?: Array<{ message: string }>;
};
