{{/* Common name helpers for the Street chart. */}}
{{- define "street.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "street.fullname" -}}
{{- printf "%s-%s" .Release.Name (include "street.name" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "street.labels" -}}
app.kubernetes.io/name: {{ include "street.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
{{- end -}}

{{- define "street.selectorLabels" -}}
app.kubernetes.io/name: {{ include "street.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
