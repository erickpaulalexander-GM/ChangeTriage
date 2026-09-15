# Change Triage – Blueprint v1.0

## Proyecto
Portal de Validación de Cambios en Producción

## Objetivo
Construir una SPA estática (HTML/CSS/JS) donde Python únicamente genera `data.json` a partir del Excel `ControlPases.xlsx`.

## Arquitectura

El proyecto toma como raíz la carpeta:

`D:\IA_DEV\ChangeTriage`

Estructura objetivo:

```text
ChangeTriage/
│
├── backend/
│   ├── parser_excel.py
│   ├── normalizador.py
│   ├── generar_data.py
│   ├── schema.py
│   ├── config.py
│   └── utils.py
│
├── frontend/
│   ├── index.html
│   └── assets/
│       ├── css/
│       ├── js/
│       ├── icons/
│       ├── fonts/
│       └── images/
│           ├── BCP.png
│           └── Kyndryl.png
│
├── workspace/
│   ├── input/
│   │   └── ControlPases.xlsx
│   ├── output/
│   │   ├── index.html
│   │   ├── assets/
│   │   └── data/
│   │       └── data.json
│   ├── logs/
│   └── cache/
│
├── docs/
│   ├── BLUEPRINT.md
│   ├── PRD.md
│   └── DATA_DICTIONARY.md
│
├── config.yaml
├── README.md
└── .gitignore
```

## Flujo

`workspace/input/ControlPases*.xlsx`
→ parser_excel.py
→ normalizador.py
→ data.json
→ workspace/output/index.html
→ SharePoint / Teams

## Configuración

Toda la configuración editable vive en `config.yaml`.

## Bootstrap (obligatorio)

En la primera ejecución el agente debe:

1. Crear `workspace/input`, `output`, `logs` y `cache`.
2. Si `ControlPases.xlsx` está en la raíz, moverlo a `workspace/input`.
3. Si `BCP.png` o `Kyndryl.png` están en la raíz, moverlos a `frontend/assets/images`.
4. Crear una página "Sin datos" si aún no existe `data.json`.

## UI

Tema oscuro.

Pantallas:

- Home
- Detail Drawer
- Modo Incidente

## Agrupación de detalle

1. Resumen
2. Implementación
3. Reversión
4. Impacto
5. Responsables
6. Gobernanza

## Modo Incidente

Buscar cambios donde:

`inicioImplementacion <= horaIncidente <= finImplementacion`

## Exportaciones

- CSV
- PDF
- Copiar resumen Teams

## Restricciones

- Sin React.
- Sin backend.
- Python solo genera datos.
- El frontend nunca lee el Excel.
