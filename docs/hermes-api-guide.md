# Hermes Pegasus Courier API Integration Guide

This guide covers the Hermes Pegasus endpoints used to authenticate, resolve service areas, calculate shipping costs, and create courier vouchers.

It combines the [official Hermes REST API documentation](https://www.tesae.gr/pegasus-hermes-rest-api) with behavior verified during the GT Courier integration.

## Base URL

~~~text
https://login.gtcourier.gr
~~~

All paths below are relative to this URL.

## General conventions

- Responses are JSON and contain top-level `code` and `data` properties. Some responses also contain `info` pagination metadata.
- Dates use `YYYY-MM-DD`; times use `HH:mm`.
- The API expects `multipart/form-data` for login and voucher creation.
- After login, send the returned session ID as `sid` on authenticated requests. GET requests use the query string; form-data requests include it as a form field.
- Treat `sid` like a credential. Do not log it or expose it in source code, shared documents, or client-side applications.
- Send codes such as `001` as strings so their leading zeroes are preserved.
- Fields that are conceptually numeric may be returned as strings or empty strings. Deserialize defensively.

## Integration flow

1. Log in and retain the returned `sid`.
2. Resolve both sender and receiver postal codes with `make_zonearea`.
3. Select the correct service-area result when a postal code has multiple matches.
4. Calculate the shipping cost with the selected service-area and zone codes.
5. Create the voucher with the selected work type and the same shipment data.

> **Important:** A postal code may return multiple service areas. Selecting the wrong result can produce an incorrect price or voucher.

## 1. Log in

Creates an authenticated API session.

~~~http
POST /hermes_api/kernel/login
Content-Type: multipart/form-data
~~~

### Form fields

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `username` | String | Yes | Hermes API username. |
| `password` | String | Yes | Hermes API password. |
| `type` | String | Recommended | Use `json` to request JSON data. |
| `lang` | String | No | Response language: `EN` or `GR`. The language remains active for subsequent requests in the session. |

### Example request

~~~bash
curl --request POST 'https://login.gtcourier.gr/hermes_api/kernel/login' \
  --form 'username=<USERNAME>' \
  --form 'password=<PASSWORD>' \
  --form 'type=json' \
  --form 'lang=EN'
~~~

### Successful response

~~~json
{
  "code": 200,
  "data": {
    "sid": "<SESSION_ID>"
  }
}
~~~

### Invalid-credentials response

~~~json
{
  "code": 401,
  "data": [
    {
      "error": {
        "title": "Login Failed",
        "detail": "The login failed, please check the username and the password"
      }
    }
  ]
}
~~~

The API also documents a `403` response when the user is already connected to the service.

## 2. Find a service area and zone

Returns the available courier service areas for a country and postal code.

~~~http
GET /hermes_api/courier/make_zonearea
~~~

### Query parameters

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `d23p01` | String | Yes | Country code. This integration currently uses `GR`. |
| `r21p02` | String | Yes | Postal code to resolve. |
| `sid` | String | Yes | Session ID returned by login. |

### Example request

~~~http
GET https://login.gtcourier.gr/hermes_api/courier/make_zonearea?d23p01=GR&r21p02=12133&sid=<SESSION_ID>
~~~

### Response fields and downstream mapping

| Response field | Description | Sender field | Receiver field |
| --- | --- | --- | --- |
| `d23p01` | Country code | `p0104country` | `p0204country` |
| `r21p02` | Postal code | `p0108` | `p0208` |
| `r07p02` | Service-area description | Used to choose the correct match | Used to choose the correct match |
| `r07p01` | **Service-area code** | `p0104` | `p0204` |
| `r02p01` | **Zone code** | `p0105` | `p0205` |

> **Verified mapping:** `r07p01` is the service area and `r02p01` is the zone. Preserve this mapping in both `calculate_cost` and voucher creation.

### Example response

~~~json
{
  "code": 200,
  "data": [
    {
      "d23p01": "GR",
      "r21p02": "12133",
      "r07p02": "ΧΕΡΣΑΙΟΙ ΠΡΟΟΡΙΣΜΟΙ",
      "r02p01": "003",
      "r07p01": "2",
      "addr": null,
      "area": null
    },
    {
      "d23p01": "GR",
      "r21p02": "12133",
      "r07p02": "ΜΠΟΥΡΝΑΖΙ",
      "r02p01": "003",
      "r07p01": "19979",
      "addr": null,
      "area": null
    },
    {
      "d23p01": "GR",
      "r21p02": "12133",
      "r07p02": "ΠΕΡΙΣΤΕΡΙ",
      "r02p01": "003",
      "r07p01": "21798",
      "addr": null,
      "area": null
    }
  ],
  "info": {
    "recperpage": 9999999999,
    "page": 0,
    "totalrec": 0
  }
}
~~~

Selecting `ΜΠΟΥΡΝΑΖΙ` means passing `19979` as the receiver service area (`p0204`) and `003` as the receiver zone (`p0205`).

## 3. Calculate shipping cost

Validates shipment data, applies configured defaults, and returns the applicable work types and prices.

~~~http
GET /hermes_api/courier/calculate_cost
~~~

### Query parameters

| Field | Type | Description |
| --- | --- | --- |
| `p126` | Number | Order type: `1` = order, `2` = send, `3` = receive. |
| `p04` | String | Work type. In this integration, `001` charges the sender and `002` charges the receiver. Omit it to return all applicable work types. |
| `p101` | Number | Weight in kilograms. |
| `p102`, `p103`, `p104` | Number | Length, width, and height in centimetres. |
| `p0104country` / `p0204country` | String | Sender/receiver country code. |
| `p0104` / `p0204` | String | Sender/receiver service-area code: `r07p01` from `make_zonearea`. |
| `p0105` / `p0205` | String | Sender/receiver zone code: `r02p01` from `make_zonearea`. |
| `p0102` / `p0202` | String | Sender/receiver street address. |
| `p0108` / `p0208` | String | Sender/receiver postal code. |
| `p0103` / `p0203` | String | Sender/receiver locality or area name. |
| `p106` / `p109` | Date | Desired pickup/delivery date. Usually filled automatically. |
| `p107`–`p108` | String | Desired pickup window, in `HH:mm` format. |
| `p110`–`p111` | String | Desired delivery window, in `HH:mm` format. |
| `p022` | Number | Cash-on-delivery amount paid in cash. |
| `p023` | Number | Cash-on-delivery amount paid by cheque. |
| `sid` | String | Session ID returned by login. |

Required address fields depend on the order type and Hermes account configuration. For order type `2`, the API can initialize the sender from the authenticated user's configured details.

### Example request

~~~http
GET https://login.gtcourier.gr/hermes_api/courier/calculate_cost?p126=2&p04=001&p101=2.5&p0104=2&p0105=003&p0108=12132&p0204=19979&p0205=003&p0208=12133&sid=<SESSION_ID>
~~~

### Example response

~~~json
{
  "code": 200,
  "data": {
    "validatedata": {
      "p126": 2,
      "p04": "001",
      "p101": "2.5",
      "p0104": "2",
      "p0204": "19979",
      "p0105": "003",
      "p0205": "003",
      "p0108": "12132",
      "p0208": "12133",
      "p106": "2026-10-19",
      "p109": "2026-10-20"
    },
    "total": [
      {
        "r01p01": "001",
        "r01p02": "Επόμενη Ημέρα",
        "r01p30": " ",
        "r18p05": 16,
        "r18p07": "",
        "r18p08": "",
        "r18p010": 16,
        "r18p011": 3.84,
        "r18p012": 19.84,
        "r04p013": "",
        "r04p014": ""
      }
    ]
  }
}
~~~

### Price result fields

| Field | Description |
| --- | --- |
| `r01p01` | Work type code. Pass the selected value as `p04` when creating the voucher. |
| `r01p02` | Work type description. |
| `r18p05` | Route price based on zones. |
| `r18p07` | Other charges. |
| `r18p08` | Special charges. |
| `r18p010` | Net price. |
| `r18p011` | VAT. |
| `r18p012` | Final price including VAT. |
| `r04p013` / `r04p014` | Minimum/maximum delivery days, when available. |

The `validatedata` object contains the request after the API has applied defaults and validation. It is useful for diagnosing unexpected areas, dates, or prices.

## 4. Create a voucher

Creates a courier voucher. If `p01` is empty or omitted, the API generates the voucher number.

~~~http
POST /hermes_api/courier/r18
Content-Type: multipart/form-data
~~~

### Form fields

#### Shipment

| Field | Type | Description |
| --- | --- | --- |
| `p01` | String | Optional voucher number. Generated automatically when empty. |
| `p126` | Number | Order type: `1` = order, `2` = send, `3` = receive. |
| `p04` | String | Work type selected from `calculate_cost`. If omitted, the API chooses the first applicable work type. |
| `p014` | String | Optional status code. The new-voucher default is used when empty. |
| `p120` | Number | Pieces; defaults to `1` when empty. |
| `p101` | Number | Weight in kilograms. |
| `p102`, `p103`, `p104` | Number | Length, width, and height in centimetres. |

#### Sender and receiver

| Sender | Receiver | Description |
| --- | --- | --- |
| `p0100` | `p0200` | CRM person or associated branch ID. If supplied, Hermes can populate the party's remaining fields. |
| `p0101` | `p0201` | Name/title. |
| `p0104country` | `p0204country` | Country code. |
| `p0104` | `p0204` | Service-area code (`r07p01`). |
| `p0105` | `p0205` | Zone code (`r02p01`). |
| `p0102` | `p0202` | Address. |
| `p0108` | `p0208` | Postal code. |
| `p0103` | `p0203` | Locality/area name. |
| `p0106` | `p0206` | Primary phone. |
| `p0109` | `p0209` | Secondary phone. |
| `p0110` | `p0210` | Email address. |
| `p0107` | `p0207` | Optional notes. |

For order type `2`, sender details may be initialized from the authenticated user. Supplying `p0100` can also populate them from a configured person or branch. Whether explicit sender fields can be omitted therefore depends on the account configuration.

#### Scheduling and cash on delivery

| Field | Type | Description |
| --- | --- | --- |
| `p106` / `p109` | Date | Desired pickup/delivery date (`YYYY-MM-DD`). |
| `p107`–`p108` | String | Desired pickup time window (`HH:mm`). |
| `p110`–`p111` | String | Desired delivery time window (`HH:mm`). |
| `p022` | Number | Cash-on-delivery amount in cash; for example, `64.30`. |
| `p023` | Number | Cash-on-delivery amount by cheque. |
| `sid` | String | Session ID returned by login. |

Dates and times are normally filled automatically. Send them only when a specific date or time window is required.

### Example request

The endpoint expects form-data, so this cURL example is preferable to a JSON body:

~~~bash
curl --request POST 'https://login.gtcourier.gr/hermes_api/courier/r18' \
  --form 'sid=<SESSION_ID>' \
  --form 'p126=2' \
  --form 'p04=001' \
  --form 'p120=1' \
  --form 'p101=2.5' \
  --form 'p102=10' \
  --form 'p103=20' \
  --form 'p104=5' \
  --form 'p0101=Example Sender' \
  --form 'p0110=sender@example.com' \
  --form 'p0106=6900000000' \
  --form 'p0104country=GR' \
  --form 'p0104=20671' \
  --form 'p0105=003' \
  --form 'p0102=20 Example Street' \
  --form 'p0108=34131' \
  --form 'p0103=Example Area' \
  --form 'p0201=Example Receiver' \
  --form 'p0210=receiver@example.com' \
  --form 'p0206=6900000001' \
  --form 'p0204country=GR' \
  --form 'p0204=1' \
  --form 'p0205=006' \
  --form 'p0202=10 Destination Street' \
  --form 'p0208=32009' \
  --form 'p0203=Destination Area' \
  --form 'p106=2026-10-20'
~~~

### Successful response

~~~json
{
  "code": 201,
  "data": {
    "nr01": "30175188",
    "p01": "V-30175188"
  },
  "info": {
    "recperpage": 9999999999,
    "page": 0,
    "totalrec": 0
  }
}
~~~

`nr01` is the internal unique voucher ID. `p01` is the public voucher number used for tracking and printing. Store both.

The endpoint returns HTTP `400` when voucher data is invalid or its shipping-cost calculation fails.

## Error handling

Do not rely only on the HTTP status. Parse the body and capture `code`, error `title`, and error `detail` when present.

| HTTP status | Meaning |
| --- | --- |
| `200` | Request completed successfully. |
| `201` | Voucher created successfully. |
| `290` | GET returned no records. This is a non-standard status used by Hermes. |
| `400` | Invalid endpoint, request data, voucher data, or cost calculation. |
| `401` | Invalid credentials, insufficient access in some endpoint contexts, or an unavailable record. |
| `403` | Save failure, or a user already connected during login. |
| `405` | HTTP method is not supported. |
| `500` | POST body exceeds the server's configured limit. |

Typical error shape:

~~~json
{
  "code": 400,
  "data": {
    "error": {
      "title": "Error title",
      "detail": "Error description"
    }
  }
}
~~~

## Implementation checklist

- Keep each party's country, postal code, service area, zone, and locality together. Do not mix values from different `make_zonearea` results.
- Use the same address codes, dimensions, weight, COD amount, and work type for `calculate_cost` and voucher creation.
- Do not assume `info.totalrec` equals the length of `data`; observed responses can contain data while `totalrec` is `0`.
- Store both the internal ID (`nr01`) and voucher number (`p01`).
- Use the [official documentation](https://www.tesae.gr/pegasus-hermes-rest-api) for additional operations.

