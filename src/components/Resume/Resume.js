import React, { useState, useEffect } from "react";
import { Container, Row, Col } from "react-bootstrap";
import Button from "react-bootstrap/Button";
import Particle from "../Particle";
import Resumecontent from "./ResumeContent";
import "../../style.css";
import "bootstrap/dist/css/bootstrap.min.css";
import axios from "axios";
import pdf from "../../Assets/resume_web_jan_21.pdf";

function Resume() {
  const uri = "https://porfolio-backend.vercel.app/ranks/getRanks";
  const [spojRank, upadteSpojRank] = useState(0);
  const [hackerrank, upadteHackerank] = useState(0);
  const [sem, upadateSem] = useState(0);
  const [cgpa, upadteCgpa] = useState(0);

  useEffect(() => {
    axios
      .get(uri)
      .then((res) => {
        upadteSpojRank(res.data.message[0].spojRank);
        upadteHackerank(res.data.message[1].hackerrank);
        upadteCgpa(res.data.message[2].cgpa);
        upadateSem(res.data.message[3].sem);
      })
      .catch((err) => {
        console.log(err);
      });
  }, []);

  return (
    <Container fluid className="resume-section">
      <Particle />
      <Container>
        <Row style={{ justifyContent: "center", position: "relative" }}>
          <Button variant="primary" href={pdf} target="_blank">
            <i className="fas fa-download">&nbsp;</i>Download CV
          </Button>
        </Row>
        <Row className="resume">
          <Col md={6} className="resume-left">
            <h3 className="resume-title">Experience</h3>
            <Resumecontent
              title="Software Developer"
              company="To The New"
              date="February 2020 - Present"
              content={[
                `Project-1 : RocketFuel BlockChain, is global payments processing company offering highly efficient 1-click check-out solutions using Bitcoin, other cryptocurrencies and Bank transfers.\n I was working as a fullstack dev in this project. My role was to deliver effecient and reusable components using Vue.js and apart from this creating new API's using hapi.js, resolving bugs, delivering production ready code.`,
                "Project-2 : PWC, Pricehouse WaterCoopers is one of the biggest accounting firms in the world,\n I was the part of the backend team and main job was to write the immense amout of data into excel sheets, create worker jobs, create reports structure, formatting reports etc.",
              ]}
            />
            <Resumecontent
              title="Teaching Assistant"
              company="Coding Blocks"
              date="November 2019 - April 2020"
              content={[
                "I used to tackle questions related to the understudies joined up with Machine Learning or DataScience batch",
              ]}
            />
            <Resumecontent
              title="Mentor"
              company="Google Code In - 19'"
              date="Jan 2020 - March 2020"
              content={[
                "The position involved mentoring the school going students (13-17) years of age to introduce them to open source and giving them the opportu-nity to become part of the open source community by working on real-world software projects, supported by an international community to help them learn and succeed"
              ]}
            />
            
            
          </Col>
          <Col md={6} className="resume-right">
            <h3 className="resume-title">Education</h3>
            <Resumecontent
              title="Bachleors in Information Technology [BVCOE]"
          
              date="2017 - Present"
              content={[`CGPA: ${8.776}`]}
            />
            <Resumecontent
              title="12TH BOARD [ CBSE, MVN(faridabad) ]"
              date="2015 - 2017"
              content={["Precentage: 88%"]}
            />
            <h3 className="resume-title">Ranks and Achivements</h3>
            <Resumecontent
              title=""
              content={[
                `3 ★ @ CodeChef`,
                `First Prize in IDEAHACK
                 HACKER-EARTH(BVP)`,
                `Secured 6th Rank in Programming Contest
                Nagarro and Coding Blocks`,
                `Second Prize in RoboSoccer(DU)`,
                `First Prize in RoboRugby AVENSIS (MSIT)`,
                `Second Prize in Technovate
                INNERVE(IGDTUW)`
              ]}
            />
          </Col>
        </Row>
        <Row style={{ justifyContent: "center", position: "relative" }}>
          <Button variant="primary" href={pdf} target="_blank">
            <i className="fas fa-download">&nbsp;</i>Download CV
          </Button>
        </Row>
      </Container>
    </Container>
  );
}

export default Resume;
