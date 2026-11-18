--
-- PostgreSQL database dump
--

\restrict iceiS8p1hivQCalIULTsuD9CBNhVHdKSMFzy4XbVOTfR43sU6zrai24qpboT1WC

-- Dumped from database version 15.20
-- Dumped by pg_dump version 15.20

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

ALTER TABLE IF EXISTS ONLY public.orders DROP CONSTRAINT IF EXISTS orders_product_id_fkey;
DROP INDEX IF EXISTS public.idx_products_id;
DROP INDEX IF EXISTS public.idx_orders_product_id;
DROP INDEX IF EXISTS public.idx_orders_created_at;
ALTER TABLE IF EXISTS ONLY public.products DROP CONSTRAINT IF EXISTS products_pkey;
ALTER TABLE IF EXISTS ONLY public.orders DROP CONSTRAINT IF EXISTS orders_pkey;
ALTER TABLE IF EXISTS public.products ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.orders ALTER COLUMN id DROP DEFAULT;
DROP SEQUENCE IF EXISTS public.products_id_seq;
DROP TABLE IF EXISTS public.products;
DROP SEQUENCE IF EXISTS public.orders_id_seq;
DROP TABLE IF EXISTS public.orders;
SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orders (
    id integer NOT NULL,
    product_id integer NOT NULL,
    quantity integer NOT NULL,
    total_price numeric(12,2) NOT NULL,
    status character varying(50) DEFAULT 'CREATED'::character varying,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT orders_quantity_check CHECK ((quantity > 0)),
    CONSTRAINT orders_total_price_check CHECK ((total_price >= (0)::numeric))
);


--
-- Name: orders_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.orders_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: orders_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.orders_id_seq OWNED BY public.orders.id;


--
-- Name: products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.products (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    price numeric(12,2) NOT NULL,
    stock integer NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT products_price_check CHECK ((price >= (0)::numeric)),
    CONSTRAINT products_stock_check CHECK ((stock >= 0))
);


--
-- Name: products_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.products_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: products_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.products_id_seq OWNED BY public.products.id;


--
-- Name: orders id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders ALTER COLUMN id SET DEFAULT nextval('public.orders_id_seq'::regclass);


--
-- Name: products id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products ALTER COLUMN id SET DEFAULT nextval('public.products_id_seq'::regclass);


--
-- Data for Name: orders; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.orders (id, product_id, quantity, total_price, status, created_at) FROM stdin;
\.


--
-- Data for Name: products; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.products (id, name, price, stock, created_at) FROM stdin;
1	Bàn phím cơ không dây AKKO 3087	1250000.00	50	2026-11-18 11:23:20.465879+00
2	Chuột Gaming Logitech G502 Hero	890000.00	35	2026-11-18 11:23:20.465879+00
3	Tai nghe chống ồn Sony WH-1000XM5	6490000.00	15	2026-11-18 11:23:20.465879+00
4	Màn hình Dell UltraSharp 27 inch 4K	11200000.00	10	2026-11-18 11:23:20.465879+00
5	Giá đỡ laptop nhôm tản nhiệt	320000.00	100	2026-11-18 11:23:20.465879+00
6	Webcam Full HD 1080p 60fps	750000.00	25	2026-11-18 11:23:20.465879+00
7	Đèn bàn thông minh LED chống cận	450000.00	40	2026-11-18 11:23:20.465879+00
8	Ổ cứng di động SSD Samsung T7 1TB	2350000.00	20	2026-11-18 11:23:20.465879+00
9	Cáp sạc nhanh Type-C 100W Anker	190000.00	80	2026-11-18 11:23:20.465879+00
10	Củ sạc GaN 65W 3 cổng	490000.00	60	2026-11-18 11:23:20.465879+00
11	Hub chuyển đổi USB-C 8 trong 1	620000.00	30	2026-11-18 11:23:20.465879+00
12	Loa Bluetooth JBL Flip 6	2490000.00	18	2026-11-18 11:23:20.465879+00
13	Micro thu âm USB Podcast	1150000.00	12	2026-11-18 11:23:20.465879+00
14	Ghế công thái học Ergonomic Pro	3800000.00	8	2026-11-18 11:23:20.465879+00
15	Bàn làm việc nâng hạ tự động	7500000.00	5	2026-11-18 11:23:20.465879+00
16	Miếng lót chuột cỡ lớn 90x40cm	120000.00	150	2026-11-18 11:23:20.465879+00
17	Quạt mini để bàn tích điện	180000.00	45	2026-11-18 11:23:20.465879+00
18	Pin sạc dự phòng 20.000mAh	550000.00	40	2026-11-18 11:23:20.465879+00
19	Túi chống sốc laptop 15.6 inch	220000.00	70	2026-11-18 11:23:20.465879+00
20	Sản phẩm thử nghiệm Flash Sale giới hạn	99000.00	5	2026-11-18 11:23:20.465879+00
\.


--
-- Name: orders_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.orders_id_seq', 1, false);


--
-- Name: products_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.products_id_seq', 20, true);


--
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);


--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);


--
-- Name: idx_orders_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_created_at ON public.orders USING btree (created_at);


--
-- Name: idx_orders_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_product_id ON public.orders USING btree (product_id);


--
-- Name: idx_products_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_id ON public.products USING btree (id);


--
-- Name: orders orders_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- PostgreSQL database dump complete
--

\unrestrict iceiS8p1hivQCalIULTsuD9CBNhVHdKSMFzy4XbVOTfR43sU6zrai24qpboT1WC

