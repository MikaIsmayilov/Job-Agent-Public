"""ATS connector registry. Each connector: fetch(sess, company, cfg) -> list[posting dict]."""

from . import amazon, ashby, greenhouse, lever, phenom, recruitee, smartrecruiters, workable, workday
from ..generic_site import fetch_company_site

ATS_CONNECTORS = {
    "amazon": amazon.fetch,
    "greenhouse": greenhouse.fetch,
    "lever": lever.fetch,
    "ashby": ashby.fetch,
    "smartrecruiters": smartrecruiters.fetch,
    "workday": workday.fetch,
    "workable": workable.fetch,
    "recruitee": recruitee.fetch,
    "phenom": phenom.fetch,
    "company_site": fetch_company_site,
}
