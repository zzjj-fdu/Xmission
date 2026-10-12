// Explicit isolated acceptance profiles never read or overwrite ordinary user keys.
fn scoped_account(base:&str,scope:Option<&str>,isolated:bool)->String{
    match scope.filter(|s|isolated&&s.len()>=4&&s.len()<=64&&s.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'-')){Some(scope)=>format!("{base}.qa.{scope}"),None=>base.to_owned()}
}
pub(crate) fn account(base:&str)->String{scoped_account(base,std::env::var("XMISSION_QA_CREDENTIAL_SCOPE").ok().as_deref(),std::env::var_os("XMISSION_DATA_DIR").is_some())}
#[cfg(not(test))]
pub(crate) fn cleanup_qa()->Result<(),String>{
    let scope=std::env::var("XMISSION_QA_CREDENTIAL_SCOPE").map_err(|_|"仅隔离验收配置可清理验收凭据")?;
    if scoped_account("llm_api_key",Some(&scope),std::env::var_os("XMISSION_DATA_DIR").is_some())=="llm_api_key"{return Err("验收凭据范围无效".into());}
    for base in ["llm_api_key","local_agent_access"]{match keyring::Entry::new("xmission",&account(base)).map_err(|e|e.to_string())?.delete_credential(){Ok(())|Err(keyring::Error::NoEntry)=>{},Err(e)=>return Err(e.to_string())}}
    Ok(())
}
#[cfg(test)]mod tests{use super::*;#[test]fn explicit_qa_accounts_are_isolated_and_normal_accounts_remain_compatible(){assert_eq!(scoped_account("llm_api_key",None,true),"llm_api_key");assert_eq!(scoped_account("llm_api_key",Some("inn-fixture"),false),"llm_api_key");assert_eq!(scoped_account("llm_api_key",Some("inn-fixture"),true),"llm_api_key.qa.inn-fixture");assert_eq!(scoped_account("local_agent_access",Some("../unsafe"),true),"local_agent_access");}}
