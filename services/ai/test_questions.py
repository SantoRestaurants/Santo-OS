"""
Tests for AI Question Answering System

Tests that all 25 predefined questions are correctly identified
without needing actual database connections.
"""

import pytest
from unittest.mock import MagicMock
from services.ai.questions import QuestionAnswerer, parse_date_from_question, fmt_mxn, fmt_pct
from datetime import date


# Mock Supabase client
@pytest.fixture
def mock_supabase():
    return MagicMock()


@pytest.fixture
def answerer(mock_supabase):
    return QuestionAnswerer(mock_supabase)


# Question identification tests
class TestQuestionIdentification:
    """Test that each question is correctly identified by its matcher"""
    
    def test_q1_amex_deposits_today(self, answerer):
        q = "¿Cuánto de las ventas procesadas por American Express se depositó en la cuenta bancaria el día de hoy?"
        assert answerer._is_q1(q.lower())
    
    def test_q2_banorte_deposits_today(self, answerer):
        q = "¿Cuánto de las ventas procesadas por las terminales de Banorte se depositó en la cuenta bancaria el día de hoy?"
        assert answerer._is_q2(q.lower())
    
    def test_q3_amex_pending(self, answerer):
        q = "¿Cuánto falta por depositarse en la cuenta bancaria de las ventas procesadas por American Express?"
        assert answerer._is_q3(q.lower())
    
    def test_q4_banorte_pending(self, answerer):
        q = "¿Cuánto falta por depositarse en la cuenta bancaria de las ventas procesadas por las terminales de Banorte?"
        assert answerer._is_q4(q.lower())
    
    def test_q5_cxc_percentage(self, answerer):
        q = "¿Qué porcentaje de las ventas totales representan las cuentas por cobrar?"
        assert answerer._is_q5(q.lower())
    
    def test_q6_cash_for_tips(self, answerer):
        q = "Del efectivo recaudado entre el día 2026-06-01 y el día 2026-06-30, ¿cuánto se requiere para el pago de propinas?"
        assert answerer._is_q6(q.lower())
    
    def test_q7_real_cash_sales(self, answerer):
        q = "Entre el día 2026-06-01 y el día 2026-06-30, ¿cuál fue el efectivo real recaudado por ventas de la sucursal?"
        assert answerer._is_q7(q.lower())
    
    def test_q8_courtesy_cash(self, answerer):
        q = "Entre el día 2026-06-01 y el día 2026-06-30, ¿cuánto efectivo correspondiente a cortesías de dirección recaudó la sucursal?"
        assert answerer._is_q8(q.lower())
    
    def test_q9_bank_tips_vs_sales(self, answerer):
        q = "Del dinero depositado en la cuenta bancaria entre el día 2026-06-01 y el día 2026-06-30, ¿cuánto corresponde a propinas y cuánto corresponde a ingresos reales por ventas?"
        assert answerer._is_q9(q.lower())
    
    def test_q10_tips_percentage(self, answerer):
        q = "¿Qué porcentaje representan las propinas respecto al total de las ventas del mes de junio?"
        assert answerer._is_q10(q.lower())
    
    def test_q11_amex_deposited_june(self, answerer):
        q = "¿Cuánto del ingreso correspondiente a ventas realizadas con American Express durante junio ya fue depositado en la cuenta bancaria?"
        assert answerer._is_q11(q.lower())
    
    def test_q12_banorte_deposited_june(self, answerer):
        q = "¿Cuánto de las ventas procesadas mediante las terminales de Banorte durante junio ya fue depositado en la cuenta bancaria?"
        assert answerer._is_q12(q.lower())
    
    def test_q13_amex_pending_month_end(self, answerer):
        q = "Al cierre del mes de junio, ¿cuáles son los depósitos pendientes de recibir en la cuenta bancaria correspondientes a ventas de junio realizadas con American Express?"
        assert answerer._is_q13(q.lower())
    
    def test_q14_banorte_pending_month_end(self, answerer):
        q = "Al cierre del mes de junio, ¿cuál es el monto total pendiente por depositarse en la cuenta bancaria correspondiente a ventas de junio realizadas mediante las terminales de Banorte?"
        assert answerer._is_q14(q.lower())
    
    def test_q15_may_deposits_in_june_banorte(self, answerer):
        q = "¿Qué ingresos depositados durante junio corresponden a ventas realizadas en mayo? Indicar el monto y la fecha de cada depósito de Banorte."
        assert answerer._is_q15(q.lower())
    
    def test_q16_may_amex_in_june(self, answerer):
        q = "¿Cuánto dinero ingresó a la cuenta bancaria durante junio correspondiente a ventas realizadas en mayo mediante American Express?"
        assert answerer._is_q16(q.lower())
    
    def test_q17_amex_commission_rate(self, answerer):
        q = "¿Cuál es el porcentaje de comisión, sin incluir IVA, que cobra la terminal de American Express sobre las ventas procesadas?"
        assert answerer._is_q17(q.lower())
    
    def test_q18_uber_sales_june(self, answerer):
        q = "¿Cuál fue el monto total de las ventas realizadas a través de Uber durante el mes de junio?"
        assert answerer._is_q18(q.lower())
    
    def test_q19_rappi_sales_june(self, answerer):
        q = "¿Cuál fue el monto total de las ventas realizadas a través de Rappi durante el mes de junio?"
        assert answerer._is_q19(q.lower())
    
    def test_q20_uber_deposits_june(self, answerer):
        q = "¿Cuál fue el monto total de los depósitos recibidos de Uber durante el mes de junio?"
        assert answerer._is_q20(q.lower())
    
    def test_q21_rappi_deposits_june(self, answerer):
        q = "¿Cuál fue el monto total de los depósitos recibidos de Rappi durante el mes de junio?"
        assert answerer._is_q21(q.lower())
    
    def test_q22_uber_commission_pct(self, answerer):
        q = "¿Qué porcentaje representan las comisiones cobradas por Uber respecto al total de los depósitos recibidos de dicha plataforma durante el mes de junio?"
        assert answerer._is_q22(q.lower())
    
    def test_q23_rappi_commission_pct(self, answerer):
        q = "¿Qué porcentaje representan las comisiones cobradas por Rappi respecto al total de los depósitos recibidos de dicha plataforma durante el mes de junio?"
        assert answerer._is_q23(q.lower())
    
    def test_q24_uber_sales_pct(self, answerer):
        q = "¿Qué porcentaje de las ventas totales del mes de junio corresponde a ventas realizadas a través de Uber?"
        assert answerer._is_q24(q.lower())
    
    def test_q25_rappi_sales_pct(self, answerer):
        q = "¿Qué porcentaje de las ventas totales del mes de junio corresponde a ventas realizadas a través de Rappi?"
        assert answerer._is_q25(q.lower())


class TestDateParsing:
    """Test date range extraction from questions"""
    
    def test_parse_month_name_junio(self):
        q = "durante el mes de junio"
        result = parse_date_from_question(q)
        assert result is not None
        start, end = result
        assert start.month == 6
        assert end.month == 6
    
    def test_parse_explicit_date_range(self):
        q = "entre el día 2026-06-01 y el día 2026-06-30"
        result = parse_date_from_question(q)
        assert result is not None
        start, end = result
        assert start == date(2026, 6, 1)
        assert end == date(2026, 6, 30)


class TestAnswerFormatting:
    """Test answer formatting helpers"""
    
    def test_format_currency(self):
        assert fmt_mxn(1234.56) == "$1,234.56"
        assert fmt_mxn(0) == "$0.00"
        assert fmt_mxn(None) == "$0.00"
    
    def test_format_percentage(self):
        assert fmt_pct(12.345) == "12.3%"
        assert fmt_pct(0) == "0.0%"
        assert fmt_pct(None) == "0.0%"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
