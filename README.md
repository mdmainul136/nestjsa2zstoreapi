# A2Z Outlet Store — Enterprise Cross-Border E-Commerce & WMS API 🚀

[![NestJS](https://img.shields.io/badge/NestJS-12.x-E0234E?logo=nestjs&logoColor=white)](https://nestjs.com)
[![Fastify](https://img.shields.io/badge/Fastify-Platform-000000?logo=fastify&logoColor=white)](https://fastify.dev/)
[![Prisma](https://img.shields.io/badge/Prisma-6.x-2D3748?logo=prisma&logoColor=white)](https://prisma.io)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Docker](https://img.shields.io/badge/Docker-Load--Balanced-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

> Production-grade, high-throughput NestJS Backend API powering the **A2Z Outlet Store** ecosystem: Global Cross-Border E-Commerce, Multi-Leg Pricing, 12-Stage Warehouse Management System (WMS), NBR Tax Compliance, and AI-Driven Product Catalog Enrichment.

---

## 🌐 Live Services & Documentation

- **Swagger API Documentation:** [https://nestapi.a2zoutletstore.com/docs](https://nestapi.a2zoutletstore.com/docs)
- **API Base URL:** [https://nestapi.a2zoutletstore.com/api](https://nestapi.a2zoutletstore.com/api)
- **Health Check Endpoint:** [https://nestapi.a2zoutletstore.com/health](https://nestapi.a2zoutletstore.com/health)

---

## 🌟 Core System Modules

### 1. 📦 Cross-Border PIM & Catalog Engine
- **Product Information Management (PIM):** Multi-attribute variants, category trees (Main, Sub, Child), and brand mapping.
- **Scraper Ingestion Pipeline:** Bi-directional sync with SaaS scrapers and Chrome extensions with manual price override protection.
- **3-Leg Dynamic Pricing Engine:** Calculates retail pricing across source item costs, warehouse handling, customs tariffs, and international freight.

### 2. 🏭 12-Stage Enterprise WMS (Warehouse Management)
- **Barcode & Location Management:** Parcel intake, QR/Barcode scanning, Bin/Rack allocation, and multi-warehouse routing.
- **Quality Control (QC) & Repacking:** Automated inspection workflows, volumetric weight calculation, and manifest dispatch.
- **Courier & Manifest Integrations:** Multi-carrier logistics tracking and automated dispatch schedules.

### 3. 🔍 Native High-Performance Search Engine
- PostgreSQL native Full-Text Search and Trigram (`pg_trgm`) indexation.
- Real-time search suggestions, trending keywords, and fuzzy matching for millions of records.

### 4. 🇧🇩 NBR & Tax Compliance System
- Automated generation of Bangladesh NBR VAT registers: **Mushak 6.3** (Challan) and **Mushak 9.1**.
- HS Code classification, sales/purchase audit exports, and duty calculations.

### 5. 💳 Payments, Wallet & CRM
- Integrated payment gateways (UddoktaPay, bKash, Nagad, Cards).
- Customer support ticketing, refund approval chains, and internal digital wallet ledger.

### 6. 🤖 AI Enrichment & Competitor Tracking
- Autonomous variant attribute extraction and description generation using Google Gemini.
- Competitor URL scraping, price disparity alerts, and automatic margin optimization.

---

## 🛠️ Tech Stack & Architecture

- **Runtime & Framework:** Node.js 22 (Alpine), NestJS 12, Fastify HTTP Adapter
- **Database & ORM:** PostgreSQL 16 with Prisma ORM 6.x
- **Queues & Caching:** Redis 7 with BullMQ (Background Scraping, Email, Search Indexing)
- **Load Balancing & Orchestration:** Dokploy, Traefik Reverse Proxy (Round-Robin SSL), Docker Compose Replicas

---

## 🚀 Getting Started

### Prerequisites
- Node.js >= 20.x
- PostgreSQL >= 15
- Redis >= 7
- Docker & Docker Compose (optional for containerized setup)

### Installation

```bash
# 1. Clone repository
git clone https://github.com/mdmainul136/nestjsa2zstoreapi.git
cd nestjsa2zstoreapi

# 2. Install dependencies
npm ci --legacy-peer-deps

# 3. Setup environment variables
cp .env.example .env

# 4. Generate Prisma client & sync schema
npx prisma generate
npx prisma db push

# 5. Seed initial data
npx ts-node prisma/seed.ts
```

### Running the Application

```bash
# Development mode (Hot reload on Fastify)
npm run start:dev

# Production build & start
npm run build
npm run start:prod
```

---

## 🐳 Docker & High-Availability Deployment

The project is pre-configured with a multi-instance, load-balanced `docker-compose.yml` supporting zero-downtime rolling updates:

```bash
# Build and run with 2 replicas
docker compose up -d --build
```

---

## 📄 License
This project is proprietary and confidential. Licensed under the [MIT License](LICENSE).
